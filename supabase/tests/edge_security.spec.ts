import { setContext } from "./fixtures/context.ts";

function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

Deno.test("Edge authorization, quotas and side effects", async (t) => {
  const handlers: Array<(req: Request) => Promise<Response>> = [];
  const serve = Deno.serve;
  // Capture handlers without opening ports or making external requests.
  Deno.serve = ((handler: (req: Request) => Promise<Response>) => {
    handlers.push(handler);
    return {};
  }) as typeof Deno.serve;
  try {
    await import("../functions/invite-employee/index.ts");
    await import("../functions/vacation-decision-email/index.ts");
  } finally {
    Deno.serve = serve;
  }

  const actorId = "12345678-1234-1234-1234-123456789012";
  let effects = 0;
  let savedDocument: string | undefined;
  let quotaCalls = 0;
  let quota: unknown = { allowed: true, retry_after: 0 };
  let quotaError: unknown = null;
  let administrator = true;
  const decision = { status: "aprovada", email_enviado_em: "2026-11-08T00:00:00Z" };
  const client = {
    rpc(_name: string, args: { p_actor_id: string }) {
      quotaCalls++;
      assert(args.p_actor_id === actorId, "Quota must use the verified actor");
      return Promise.resolve({ data: quota, error: quotaError });
    },
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          return Promise.resolve({ data: table === "funcionarios" ? (administrator ? { id: actorId } : null) : decision, error: null });
        },
        insert(values: { cpf: string }) { savedDocument = values.cpf; effects++; return Promise.resolve({ error: null }); },
      };
    },
    auth: { admin: { inviteUserByEmail() { effects++; return Promise.resolve({ error: null }); } } },
  };
  const authenticated = () => setContext({ data: { userClaims: { id: actorId }, supabase: client, supabaseAdmin: client }, error: null });
  const req = (body: unknown) => new Request("https://example.invalid", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://oc-mateus.github.io" }, body: JSON.stringify(body),
  });

  for (const [index, handler] of handlers.entries()) {
    await t.step(`function ${index}: rejects unauthenticated callers before side effects`, async () => {
      setContext({ data: null, error: new Error("Invalid token") });
      assert((await handler(req({}))).status === 401, "Expected authentication rejection");
      assert(effects === 0 && quotaCalls === 0, "Unauthorized request touched protected services");
    });
    await t.step(`function ${index}: rejects non-admins before quota consumption`, async () => {
      administrator = false;
      authenticated();
      assert((await handler(req({}))).status === 403, "Expected admin authorization rejection");
      assert(effects === 0 && quotaCalls === 0, "Employee request touched protected services");
      administrator = true;
    });
    await t.step(`function ${index}: exhausted or unavailable quotas block side effects`, async () => {
      authenticated();
      quota = { allowed: false, retry_after: 25 };
      const denied = await handler(req({}));
      assert(denied.status === 429 && denied.headers.get("Retry-After") === "25", "Quota must return 429 and Retry-After");
      quotaError = new Error("Unavailable");
      assert((await handler(req({}))).status === 503, "Failed quota must close access");
      assert(effects === 0, "Denied request caused a side effect");
      quotaError = null;
      quota = { allowed: true, retry_after: 0 };
      quotaCalls = 0;
    });
    await t.step(`function ${index}: rejects injected role fields`, async () => {
      assert((await handler(req({ role: "admin" }))).status === 400, "Unknown privileged field was accepted");
      assert(effects === 0, "Invalid payload caused a side effect");
      quotaCalls = 0;
    });
  }
  await t.step("a sent vacation decision returns without calling the provider", async () => {
    const response = await handlers[1](req({ solicitacao_id: actorId }));
    assert(response.status === 200, "Already sent decision should succeed without a resend");
    assert(effects === 0, "Already sent decision caused a side effect");
  });
  await t.step("invalid vacation identifiers are rejected", async () => {
    assert((await handlers[1](req({ solicitacao_id: "fake" }))).status === 400, "Invalid UUID accepted");
  });
  await t.step("valid PJ invitation accepts an empty admission date and keeps only allowed fields", async () => {
    const response = await handlers[0](req({ nome: "Test Employee", email: "test@example.invalid", cpf: "52998224725", cargo: "Test", tipo_contrato: "pj", data_admissao: null }));
    assert(response.status === 201, `Valid invitation failed: ${await response.text()}`);
    assert(effects === 2, "Expected exactly one invitation record and one provider call (both mocked)");
  });
  await t.step("numeric and alphanumeric CNPJs are canonicalized and accepted only for PJ", async () => {
    const employee = { nome: "Test Employee", email: "test@example.invalid", cargo: "Test" };
    for (const [submitted, canonical] of [["04.252.011/0001-10", "04252011000110"], ["12.abc.345/01de-35", "12ABC34501DE35"]]) {
      const before = effects;
      const clt = await handlers[0](req({ ...employee, cpf: submitted, tipo_contrato: "clt" }));
      assert(clt.status === 400 && effects === before, "A CLT invitation must reject a CNPJ before writing or sending");
      assert((await clt.json()).error.includes("CPF válido"), "CLT received the wrong validation message");
      const pj = await handlers[0](req({ ...employee, cpf: submitted, tipo_contrato: "pj" }));
      assert(pj.status === 201 && savedDocument === canonical && effects === before + 2, "Expected an accepted PJ invitation with the canonical identifier");
    }
    const before = effects;
    const invalid = await handlers[0](req({ ...employee, cpf: "12.ABC.345/01DE-36", tipo_contrato: "pj" }));
    assert(invalid.status === 400 && effects === before, "An invalid CNPJ must not create or send an invitation");
  });
});
