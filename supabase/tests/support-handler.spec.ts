import { setContext } from "./fixtures/context.ts";
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }

Deno.test("support handler keeps providers and permissions behind explicit gates", async (t) => {
  let handler: (req: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((value: typeof handler) => { handler = value; return {}; }) as typeof Deno.serve;
  try { await import("../functions/support-assistant/index.ts"); }
  finally { Deno.serve = serve; }
  const actor = "10000000-0000-0000-0000-000000000001";
  const requesterId = "10000000-0000-0000-0000-000000000002";
  let role = "employee";
  let supportAccess = false;
  let allowed = true;
  let effects = 0;
  let failQuota = false;
  const rpcCalls: string[] = [];
  const client = {
    from(table: string) {
      let lookupId = "";
      return { select() { return this; }, eq(field: string, id: string) { if (field === 'id') lookupId = id; return this; }, maybeSingle() {
        const data = table === 'support_tickets'
          ? { id: actor, protocol: 42, category: 'ponto', funcionario_id: requesterId, description: 'Mensagem completa do chamado para responder' }
          : { id: actor, role, ativo: true, suporte: supportAccess, nome: 'Pessoa Solicitante', email: lookupId === requesterId ? 'solicitante@example.invalid' : 'actor@example.invalid' };
        return Promise.resolve({ data, error: null });
      } };
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push(name);
      if (name === "consume_support_quota") {
        assert(args.p_actor_id === actor, "Quota actor must come from verified context");
        return Promise.resolve({ data: { allowed, retry_after: 30 }, error: failQuota ? new Error("offline") : null });
      }
      if (name === "create_support_ticket") { effects++; return Promise.resolve({ data: [{ id: actor, protocol: 42, category: "ponto", funcionario_id: actor, description: args.p_description }], error: null }); }
      if (name === 'claim_support_email' || name === 'finish_support_email') return Promise.resolve({ data: true, error: null });
      throw new Error("Unexpected RPC");
    },
  };
  const auth = () => setContext({ data: { userClaims: { id: actor }, supabase: client, supabaseAdmin: client }, error: null });
  const req = (body: unknown) => new Request("https://example.invalid", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" } });
  const resetEnv = () => {
    Deno.env.set("SUPPORT_ENABLED", "false");
    Deno.env.set("SUPPORT_AI_ENABLED", "false");
    Deno.env.set("SUPPORT_EMAIL_ENABLED", "false");
    for (const name of ["OPENAI_API_KEY", "SUPPORT_AI_MODEL", "SUPPORT_EMAIL", "SUPPORT_EMAIL_FROM", "FERIAS_EMAIL_FROM", "RESEND_API_KEY"]) Deno.env.set(name, "");
  };
  resetEnv();
  try {
    await t.step("unlaunched service rejects calls without any side effects", async () => {
      assert((await handler(req({ action: "ask" }))).status === 503, "Expected launch gate");
      assert(effects === 0 && rpcCalls.length === 0, "Gate allowed a side effect");
      Deno.env.set("SUPPORT_ENABLED", "true");
    });
    await t.step("authentication is required for the server assistant", async () => {
      setContext({ data: null, error: new Error("invalid") });
      assert((await handler(req({ action: "ask" }))).status === 401, "Expected authentication rejection");
      auth();
    });
    await t.step("injected identity and role fields are rejected", async () => {
      assert((await handler(req({ action: "create_ticket", role: "admin", funcionario_id: actor }))).status === 400, "Mass assignment accepted");
      assert(effects === 0, "Invalid payload created a ticket");
    });
    await t.step("quota exhaustion and outages block assistance", async () => {
      allowed = false;
      assert((await handler(req({ action: "ask", category: "acesso", question: "Esqueci minha senha" }))).status === 429, "Expected quota rejection");
      failQuota = true;
      assert((await handler(req({ action: "ask", category: "acesso", question: "Esqueci minha senha" }))).status === 503, "Quota outage must fail closed");
      allowed = true; failQuota = false;
    });
    await t.step("without AI configuration the reviewed guide remains usable", async () => {
      const response = await handler(req({ action: "ask", category: "acesso", question: "Esqueci minha senha" }));
      const body = await response.json();
      assert(response.status === 200 && body.mode === "guide" && body.article.id === "recuperar-senha", "Guide fallback unavailable");
    });
    await t.step("administrative matters receive a handoff", async () => {
      const response = await handler(req({ action: "ask", category: "ponto", question: "Preciso corrigir meu ponto" }));
      assert((await response.json()).needs_human === true, "Administrative matter was automated");
    });
    await t.step("ticket creation succeeds with mail disabled and normalized composite response", async () => {
      const response = await handler(req({ action: "create_ticket", category: "ponto", subject: "Erro no ponto", description: "O registro não foi confirmado", request_id: actor }));
      const body = await response.json();
      assert(response.status === 201 && body.ticket.protocol === 42 && body.delivery === "not_configured", "Ticket must survive absent mail configuration");
      assert(effects === 1, "Expected one saved ticket");
    });
    await t.step("only support accounts can retry email notifications, independently of admin role", async () => {
      assert((await handler(req({ action: "notify_ticket", ticket_id: actor }))).status === 403, "Employee retried protected mail");
      role = "admin";
      assert((await handler(req({ action: "notify_ticket", ticket_id: actor }))).status === 403, "Admin without support access retried mail");
      role = "employee";
      supportAccess = true;
      const response = await handler(req({ action: "notify_ticket", ticket_id: actor }));
      assert(response.status === 200 && (await response.json()).delivery === "not_configured", "Missing mail configuration should be explicit");
    });
    await t.step('support retry sends the stored message and requester reply address, not the operator identity', async () => {
      Deno.env.set('SUPPORT_EMAIL_ENABLED', 'true');
      Deno.env.set('SUPPORT_EMAIL_FROM', 'sender@example.invalid');
      Deno.env.set('RESEND_API_KEY', 'test');
      const originalFetch = globalThis.fetch;
      let sent = false;
      globalThis.fetch = ((_url: unknown, options: RequestInit) => {
        const message = JSON.parse(options.body as string);
        assert(message.reply_to === 'solicitante@example.invalid', 'Reply must go to the ticket owner');
        assert(message.text.includes('Pessoa Solicitante') && message.text.includes('Mensagem completa do chamado para responder'), 'Missing contact or message');
        assert(message.to[0] === 'mcoliveira@kairoautomacoes.com.br', 'Wrong support destination');
        sent = true;
        return Promise.resolve(new Response('{}'));
      }) as typeof fetch;
      try {
        const response = await handler(req({ action: 'notify_ticket', ticket_id: actor }));
        assert((await response.json()).delivery === 'sent' && sent, 'Expected a prepared notification');
      } finally { globalThis.fetch = originalFetch; }
    });
  } finally { resetEnv(); }
});
