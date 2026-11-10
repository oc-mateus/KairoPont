import "jsr:@supabase/functions-js@2.119.0/edge-runtime.d.ts";
import { createSupabaseContext } from "npm:@supabase/server@1.9.2";
import { enforceRateLimit, HttpError, readJsonObject, requestSecurity, stringField } from "../_shared/security.mjs";

function validCPF(value: string) {
  const cpf = value.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    const sum = [...cpf.slice(0, length)].reduce((total, char, index) => total + Number(char) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function makeSchedule(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const submitted = value as Record<string, unknown>;
  const shifts: Record<string, { start: string; end: string; lunchOut: string | null; lunchReturn: string | null }> = {
    turno1: { start: "06:00", end: "15:00", lunchOut: "12:00", lunchReturn: "13:00" },
    turno2: { start: "08:00", end: "17:00", lunchOut: "12:00", lunchReturn: "13:00" },
    turno3: { start: "14:00", end: "22:52", lunchOut: "18:00", lunchReturn: "19:00" },
  };
  const inferId = (entry: unknown) => {
    if (typeof entry !== "string" || !/^\d{2}:\d{2}/.test(entry)) return null;
    const actual = Number(entry.slice(0, 2)) * 60 + Number(entry.slice(3, 5));
    return Object.entries(shifts).reduce<{ id: string | null; distance: number }>((best, [id, candidate]) => {
      const expected = Number(candidate.start.slice(0, 2)) * 60 + Number(candidate.start.slice(3, 5));
      const rawDistance = Math.abs(actual - expected);
      const distance = Math.min(rawDistance, 1440 - rawDistance);
      return distance < best.distance ? { id, distance } : best;
    }, { id: null, distance: Infinity }).id;
  };
  const selected = Array.isArray(submitted.horarios_habituais)
    ? submitted.horarios_habituais.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).id || "") : "")
    : Object.values((submitted.horarios_por_dia && typeof submitted.horarios_por_dia === "object" ? submitted.horarios_por_dia : {}) as Record<string, Record<string, unknown>>)
      .map((item) => inferId(item?.entrada)).filter((id): id is string => Boolean(id));
  const scheduleIds = [...new Set(selected)].filter((id) => Boolean(shifts[id]));
  if (!scheduleIds.length && shifts[String(submitted.turno_id || "")]) scheduleIds.push(String(submitted.turno_id));
  if (!scheduleIds.length) return null;
  const habitualSchedules = scheduleIds.map((id) => ({
    id,
    entrada: shifts[id].start,
    saida_almoco: shifts[id].lunchOut,
    retorno_almoco: shifts[id].lunchReturn,
    saida: shifts[id].end,
  }));
  const workdays = Array.isArray(submitted.dias_semana)
    ? [...new Set(submitted.dias_semana.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 6))].sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6];
  return { tipo: scheduleIds[0], turno_id: scheduleIds[0], dias_semana: workdays.length ? workdays : [1, 2, 3, 4, 5, 6], horarios_habituais: habitualSchedules };
}

Deno.serve(async (req) => {
  const { reply: response, earlyResponse } = requestSecurity(req);
  if (earlyResponse) return earlyResponse;

  try {
    const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: "user" });
    if (authError || !ctx?.userClaims?.id) return response({ error: "Sessão inválida." }, 401);
    const { data: admin, error: adminError } = await ctx.supabase
      .from("funcionarios")
      .select("id")
      .eq("auth_id", ctx.userClaims.id)
      .eq("role", "admin")
      .eq("ativo", true)
      .maybeSingle();
    if (adminError || !admin) return response({ error: "Somente um administrador ativo pode criar contas." }, 403);

    const limited = await enforceRateLimit(ctx.supabaseAdmin, "invite-employee", ctx.userClaims.id, response);
    if (limited) return limited;

    const input = await readJsonObject(req, [
      "email", "nome", "cpf", "cargo", "tipo_contrato", "data_admissao", "escala_trabalho",
      // Older published clients send these UI-only fields; they are never persisted.
      "turno_id", "tipo", "dias_semana", "horarios_habituais", "contabilizar_atrasos",
    ]);
    const email = stringField(input, "email", 254).toLowerCase();
    const nome = stringField(input, "nome", 150);
    const cpf = stringField(input, "cpf", 18).replace(/\D/g, "");
    const cargo = stringField(input, "cargo", 100);
    const tipoContrato = stringField(input, "tipo_contrato", 3, true) || "clt";
    const dataAdmissao = stringField(input, "data_admissao", 10, true);
    const escala = tipoContrato === "clt" ? makeSchedule(input.escala_trabalho) : null;
    const todayParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const todayValues = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
    const today = todayValues.year + "-" + todayValues.month + "-" + todayValues.day;

    if (!/^\S+@\S+\.\S+$/.test(email) || nome.length < 3 || cargo.length < 2 || !validCPF(cpf) || !["clt", "pj"].includes(tipoContrato)) {
      return response({ error: "Confira o nome, e-mail, CPF e cargo informados." }, 400);
    }
    if (dataAdmissao && (!validIsoDate(dataAdmissao) || dataAdmissao > today)) {
      return response({ error: "Informe uma data de admissão válida, igual ou anterior a hoje." }, 400);
    }
    if (tipoContrato === "clt" && (!validIsoDate(dataAdmissao) || !escala)) {
      return response({ error: "Para CLT, informe uma data de admissão válida e uma escala semanal completa." }, 400);
    }

    const { error: inviteRecordError } = await ctx.supabaseAdmin
      .from("funcionario_convites")
      .insert({
        email,
        nome,
        cpf,
        cargo,
        tipo_contrato: tipoContrato,
        data_admissao: dataAdmissao || null,
        escala_trabalho: escala,
        convidado_por: admin.id,
      });
    if (inviteRecordError) {
      if (inviteRecordError.code === "23505") return response({ error: "Já existe um convite pendente para este e-mail." }, 409);
      throw inviteRecordError;
    }

    const { error: inviteError } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { nome },
      redirectTo: "https://oc-mateus.github.io/KairoPont/definir-senha",
    });
    if (inviteError) {
      await ctx.supabaseAdmin.from("funcionario_convites").delete().eq("email", email);
      if (inviteError.message.toLowerCase().includes("already registered")) {
        return response({ error: "Já existe uma conta com este e-mail." }, 409);
      }
      throw inviteError;
    }

    return response({ message: "Convite enviado para o e-mail do funcionário." }, 201);
  } catch (error) {
    if (error instanceof HttpError) return response({ error: error.message }, error.status);
    console.error("employee invite failed");
    return response({ error: "Não foi possível criar o funcionário agora. Verifique os dados e tente novamente." }, 500);
  }
});
