import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseContext } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

function isTime(value: unknown) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(value: unknown) {
  if (!isTime(value)) return -1;
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function isSchedule(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schedule = value as Record<string, unknown>;
  const days = schedule.dias_semana;
  const hoursByDay = schedule.horarios_por_dia;
  return ["5x2", "6x1", "personalizada"].includes(String(schedule.tipo))
    && Array.isArray(days) && days.length >= 1 && days.length <= 7
    && days.every((day) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7)
    && new Set(days).size === days.length
    && Boolean(hoursByDay) && typeof hoursByDay === "object" && !Array.isArray(hoursByDay)
    && days.every((day) => {
      const hours = (hoursByDay as Record<string, unknown>)[String(day)];
      if (!hours || typeof hours !== "object" || Array.isArray(hours)) return false;
      const daily = hours as Record<string, unknown>;
      if (!isTime(daily.entrada) || !isTime(daily.saida)) return false;
      if (daily.saida_almoco == null && daily.retorno_almoco == null) {
        return timeToMinutes(daily.entrada) < timeToMinutes(daily.saida);
      }
      return isTime(daily.saida_almoco) && isTime(daily.retorno_almoco)
        && timeToMinutes(daily.entrada) < timeToMinutes(daily.saida_almoco)
        && timeToMinutes(daily.saida_almoco) < timeToMinutes(daily.retorno_almoco)
        && timeToMinutes(daily.retorno_almoco) < timeToMinutes(daily.saida);
    });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método não permitido." }, 405);

  const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: "user" });
  if (authError || !ctx?.userClaims?.id) return response({ error: "Sessão inválida." }, 401);

  try {
    const { data: admin, error: adminError } = await ctx.supabase
      .from("funcionarios")
      .select("id")
      .eq("auth_id", ctx.userClaims.id)
      .eq("role", "admin")
      .eq("ativo", true)
      .maybeSingle();
    if (adminError || !admin) return response({ error: "Somente um administrador ativo pode criar contas." }, 403);

    const input = await req.json();
    const email = String(input.email || "").trim().toLowerCase();
    const nome = String(input.nome || "").trim();
    const cpf = String(input.cpf || "").replace(/\D/g, "");
    const cargo = String(input.cargo || "").trim();
    const dataAdmissao = String(input.data_admissao || "");
    const escala = input.escala_trabalho;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

    if (!/^\S+@\S+\.\S+$/.test(email) || nome.length < 3 || cargo.length < 2 || !validCPF(cpf)) {
      return response({ error: "Confira o nome, e-mail, CPF e cargo informados." }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAdmissao) || dataAdmissao > today || !isSchedule(escala)) {
      return response({ error: "Informe uma data de admissão válida e uma escala semanal completa." }, 400);
    }

    const { error: inviteRecordError } = await ctx.supabaseAdmin
      .from("funcionario_convites")
      .insert({
        email,
        nome,
        cpf,
        cargo,
        data_admissao: dataAdmissao,
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
    console.error("employee invite failed", error);
    return response({ error: "Não foi possível criar o funcionário agora. Verifique os dados e tente novamente." }, 500);
  }
});
