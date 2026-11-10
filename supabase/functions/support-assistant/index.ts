import "jsr:@supabase/functions-js@2.119.0/edge-runtime.d.ts";
import { createSupabaseContext } from "npm:@supabase/server@1.9.2";
import { HttpError, readJsonObject, requestSecurity, stringField, uuidField } from "../_shared/security.mjs";
import { answerSupportQuestion } from "../_shared/support-answer.mjs";
import { notifySupportTeam } from "../_shared/support-email.mjs";
import { DEFAULT_SUPPORT_EMAIL, SUPPORT_CATEGORIES } from "../../../shared/support.mjs";

Deno.serve(async (req) => {
  const { reply, earlyResponse } = requestSecurity(req);
  if (earlyResponse) return earlyResponse;
  // Support is enabled for the release; an explicit false remains a kill switch.
  if (Deno.env.get("SUPPORT_ENABLED") === "false") return reply({ error: "O atendimento pelo portal está temporariamente indisponível. Consulte a base de ajuda." }, 503);
  try {
    const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: "user" });
    if (authError || !ctx?.userClaims?.id) return reply({ error: "Entre na sua conta para falar com o suporte." }, 401);
    const { data: employee, error: employeeError } = await ctx.supabase.from("funcionarios")
      .select("id,role,ativo").eq("auth_id", ctx.userClaims.id).eq("ativo", true).maybeSingle();
    if (employeeError || !employee) return reply({ error: "É necessária uma conta ativa." }, 403);
    const input = await readJsonObject(req, ["action", "category", "question", "subject", "description", "request_id", "ticket_id"]);
    const action = stringField(input, "action", 20);
    if (!["ask", "create_ticket", "notify_ticket"].includes(action)) throw new HttpError(400, "Ação de suporte inválida.");

    const emailConfig = {
      enabled: Deno.env.get("SUPPORT_EMAIL_ENABLED") !== "false",
      apiKey: Deno.env.get("RESEND_API_KEY") || "",
      to: Deno.env.get("SUPPORT_EMAIL") || DEFAULT_SUPPORT_EMAIL,
      from: Deno.env.get("SUPPORT_EMAIL_FROM") || Deno.env.get("FERIAS_EMAIL_FROM") || "",
    };
    if (action === "notify_ticket") {
      if (employee.role !== "admin") return reply({ error: "Somente a equipe pode reenviar avisos." }, 403);
      const id = uuidField(input, "ticket_id");
      const { data: ticket, error } = await ctx.supabase.from("support_tickets").select("id,protocol,category,funcionario_id,description").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!ticket) return reply({ error: "Chamado não encontrado." }, 404);
      const delivery = await notifySupportTeam({ client: ctx.supabaseAdmin, ticket, actorId: ctx.userClaims.id, config: emailConfig });
      return reply({ delivery });
    }

    const category = stringField(input, "category", 20);
    if (!SUPPORT_CATEGORIES.some((item) => item.id === category)) throw new HttpError(400, "Escolha um assunto válido.");
    if (action === "create_ticket") {
      const requestId = uuidField(input, "request_id");
      const subject = stringField(input, "subject", 120);
      const description = stringField(input, "description", 3000);
      if (subject.length < 3 || description.length < 10) throw new HttpError(400, "Preencha o assunto e descreva o problema com pelo menos 10 caracteres.");
      const { data, error } = await ctx.supabase.rpc("create_support_ticket", {
        p_request_id: requestId, p_category: category, p_subject: subject, p_description: description,
      });
      if (error) {
        if (error.code === "P0001") return reply({ error: "Limite de chamados atingido. Tente novamente mais tarde." }, 429);
        if (error.code === "22023") throw new HttpError(400, "Confira os dados e inicie uma nova solicitação.");
        throw error;
      }
      const ticket = Array.isArray(data) ? data[0] : data;
      if (!ticket?.id) throw new Error("Ticket not returned");
      const delivery = await notifySupportTeam({ client: ctx.supabaseAdmin, ticket, actorId: ctx.userClaims.id, config: emailConfig });
      return reply({ ticket, delivery }, 201);
    }

    const question = stringField(input, "question", 1500);
    if (question.length < 5) throw new HttpError(400, "Descreva sua dúvida com pelo menos 5 caracteres.");
    const { data: quota, error: quotaError } = await ctx.supabaseAdmin.rpc("consume_support_quota", { p_action: "support-question", p_actor_id: ctx.userClaims.id });
    if (quotaError || typeof quota?.allowed !== "boolean") return reply({ error: "Não foi possível consultar a ajuda agora. Tente novamente em instantes." }, 503);
    if (!quota.allowed) {
      const seconds = Number.isInteger(quota.retry_after) && quota.retry_after > 0 ? quota.retry_after : 60;
      return reply({ error: "Limite de perguntas atingido. Aguarde antes de tentar novamente." }, 429, { "Retry-After": String(seconds) });
    }
    const result = await answerSupportQuestion({ question, category,
      enabled: Deno.env.get("SUPPORT_AI_ENABLED") === "true",
      apiKey: Deno.env.get("OPENAI_API_KEY") || "", model: Deno.env.get("SUPPORT_AI_MODEL") || "",
    });
    return reply(result);
  } catch (error) {
    if (error instanceof HttpError) return reply({ error: error.message }, error.status);
    console.error("support request failed");
    return reply({ error: "Não foi possível concluir o atendimento. Tente novamente em instantes." }, 500);
  }
});
