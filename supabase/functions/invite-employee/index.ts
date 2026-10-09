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

function makeSchedule(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const submitted = value as Record<string, unknown>;
  const id = String(submitted.turno_id || "");
  const shifts: Record<string, { start: string; end: string; lunchOut?: string; lunchReturn?: string }> = {
    turno1: { start: "08:00", end: "17:00", lunchOut: "12:00", lunchReturn: "13:00" },
    turno2: { start: "14:00", end: "22:52", lunchOut: "19:30", lunchReturn: "20:30" },
    turno3: { start: "22:45", end: "06:15" },
  };
  const shift = shifts[id];
  if (!shift) return null;
  const horarios_por_dia: Record<string, Record<string, string | null>> = {};
  for (const day of [1, 2, 3, 4, 5]) {
    horarios_por_dia[String(day)] = {
      entrada: shift.start,
      saida_almoco: shift.lunchOut || null,
      retorno_almoco: shift.lunchReturn || null,
      saida: shift.end,
    };
  }
  horarios_por_dia["6"] = { entrada: "08:00", saida_almoco: null, retorno_almoco: null, saida: "12:00" };
  return { tipo: id, turno_id: id, dias_semana: [1, 2, 3, 4, 5, 6], horarios_por_dia };
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
    const escala = makeSchedule(input.escala_trabalho);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

    if (!/^\S+@\S+\.\S+$/.test(email) || nome.length < 3 || cargo.length < 2 || !validCPF(cpf)) {
      return response({ error: "Confira o nome, e-mail, CPF e cargo informados." }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAdmissao) || dataAdmissao > today || !escala) {
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
