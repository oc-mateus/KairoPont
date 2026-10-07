import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseContext } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function addIsoDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Método não permitido." }, 405);

  const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: "user" });
  if (authError || !ctx?.userClaims?.id) return reply({ error: "Sessão inválida." }, 401);

  try {
    const { data: admin, error: adminError } = await ctx.supabase
      .from("funcionarios").select("id").eq("auth_id", ctx.userClaims.id)
      .eq("role", "admin").eq("ativo", true).maybeSingle();
    if (adminError || !admin) return reply({ error: "Somente um administrador ativo pode enviar este e-mail." }, 403);

    const input = await req.json();
    const requestId = String(input.solicitacao_id || "");
    const { data: request, error: requestError } = await ctx.supabaseAdmin
      .from("solicitacoes_ferias")
      .select("id, funcionario_id, periodo_id, data_inicio, data_fim, data_retorno, status, justificativa_recusa, decidida_em, email_enviado_em")
      .eq("id", requestId).maybeSingle();
    if (requestError) throw requestError;
    if (!request || !["aprovada", "recusada"].includes(request.status)) {
      return reply({ error: "Decisão finalizada não encontrada." }, 404);
    }

    const [{ data: employee, error: employeeError }, { data: cycle, error: cycleError }] = await Promise.all([
      ctx.supabaseAdmin.from("funcionarios").select("nome, email").eq("id", request.funcionario_id).maybeSingle(),
      ctx.supabaseAdmin.from("periodos_aquisitivos_ferias").select("dias_abono").eq("id", request.periodo_id).maybeSingle(),
    ]);
    if (employeeError) throw employeeError;
    if (cycleError) throw cycleError;
    if (!employee?.email) return reply({ error: "O funcionário não possui e-mail cadastrado." }, 422);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("FERIAS_EMAIL_FROM");
    if (!apiKey || !from) {
      return reply({ error: "E-mail não configurado. Cadastre RESEND_API_KEY e FERIAS_EMAIL_FROM nos secrets da função." }, 503);
    }

    const approved = request.status === "aprovada";
    const subject = `Férias ${approved ? "aprovadas" : "recusadas"} - KairoPont`;
    const returnDate = request.data_retorno || addIsoDays(request.data_fim, 1);
    const periodText = `saída em ${formatDate(request.data_inicio)} e retorno ao trabalho em ${formatDate(returnDate)}`;
    const reasonText = approved ? "" : String(request.justificativa_recusa || "");
    const html = `<div style="font-family:Arial,sans-serif;color:#173126;max-width:600px;margin:auto;padding:24px"><h1 style="color:${approved ? "#16803c" : "#b42318"}">Solicitação de férias ${approved ? "aprovada" : "recusada"}</h1><p>Olá, ${escapeHtml(employee.nome)}.</p><p>Sua solicitação para <strong>${escapeHtml(periodText)}</strong> foi <strong>${approved ? "aprovada" : "recusada"}</strong>.</p>${approved ? "" : `<p><strong>Justificativa:</strong><br>${escapeHtml(reasonText).replace(/\n/g, "<br>")}</p>`}<p>Dias convertidos em abono: ${Number(cycle?.dias_abono || 0)}.</p><p>Esta mensagem foi enviada pelo KairoPont.</p></div>`;
    const plainText = `Olá, ${employee.nome}.\n\nSua solicitação de férias para ${periodText} foi ${approved ? "aprovada" : "recusada"}.${approved ? "" : `\n\nJustificativa: ${reasonText}`}\n\nDias convertidos em abono: ${Number(cycle?.dias_abono || 0)}.\n\nKairoPont`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ferias-${request.id}-${request.decidida_em || request.status}`,
      },
      body: JSON.stringify({ from, to: [employee.email], subject, html, text: plainText }),
    });
    const resendBody = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) {
      const message = String(resendBody?.message || "Falha do provedor de e-mail").slice(0, 500);
      await ctx.supabaseAdmin.from("solicitacoes_ferias").update({ email_erro: message }).eq("id", request.id);
      return reply({ error: `Decisão registrada, mas o e-mail não foi enviado: ${message}` }, 502);
    }

    const { error: updateError } = await ctx.supabaseAdmin.from("solicitacoes_ferias")
      .update({ email_enviado_em: new Date().toISOString(), email_erro: null }).eq("id", request.id);
    if (updateError) throw updateError;
    return reply({ message: "E-mail da decisão enviado ao funcionário." });
  } catch (error) {
    console.error("vacation decision email failed", error);
    return reply({ error: "Não foi possível enviar o e-mail da decisão." }, 500);
  }
});
