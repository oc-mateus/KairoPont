import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupportReplyUrl, requiresHumanSupport, findSupportArticle, redactSupportText } from './support.mjs';
import { answerSupportQuestion } from '../supabase/functions/_shared/support-answer.mjs';
import { notifySupportTeam } from '../supabase/functions/_shared/support-email.mjs';

test('approved help topics resolve to reviewed articles', () => {
  assert.equal(findSupportArticle('esqueci a senha', 'acesso').id, 'recuperar-senha');
  assert.equal(findSupportArticle('Quero exportar Excel', 'exportacao').id, 'exportar-historico');
  assert.equal(findSupportArticle('trocar foto de perfil', 'arquivos').id, 'foto-perfil');
});

test('unmatched questions hand off instead of displaying unrelated guidance', async () => {
  assert.equal(findSupportArticle('Como faço uma solicitação?', 'acesso'), null);
  const result = await answerSupportQuestion({ question: 'Como faço uma solicitação?', category: 'acesso', enabled: false });
  assert.equal(result.needs_human, true);
  assert.equal(result.article, null);
});

test('personal data and administrative matters require a human', () => {
  for (const question of ['corrigir meu ponto', 'minhas férias', 'excluir meus dados', 'CPF 529.982.247-25', 'minha senha: segredo', 'pagamento errado']) {
    assert.equal(requiresHumanSupport(question, 'ponto'), true, question);
  }
  assert.equal(requiresHumanSupport('Como registrar entrada?', 'ponto'), false);
  assert.equal(requiresHumanSupport('Meu assunto é diferente', 'outro'), true);
  assert.doesNotMatch(redactSupportText('E-mail pessoa@example.invalid, CPF 529.982.247-25, telefone 11999998888'), /pessoa@|529|9999/);
});

test('AI disabled or out of scope never calls a provider', async () => {
  const fetchImpl = () => { throw new Error('External request forbidden'); };
  assert.equal((await answerSupportQuestion({ question: 'esqueci senha', category: 'acesso', enabled: false, fetchImpl })).mode, 'guide');
  assert.equal((await answerSupportQuestion({ question: 'corrigir ponto', category: 'ponto', enabled: true, apiKey: 'test', model: 'test', fetchImpl })).needs_human, true);
});

test('AI only selects reviewed text, minimizes input and bounds output', async () => {
  const result = await answerSupportQuestion({ question: 'Como recuperar senha? pessoa@example.invalid', category: 'acesso', enabled: true, apiKey: 'test', model: 'configured-model', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    assert.equal(payload.max_output_tokens, 256);
    assert.equal(payload.model, 'configured-model');
    assert.equal(payload.tools, undefined);
    assert.doesNotMatch(payload.input, /pessoa@example/);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ article_id: 'recuperar-senha', needs_human: false, injected_text: 'malicious instructions' }) }] }] }));
  } });
  assert.equal(result.mode, 'ai');
  assert.equal(result.article.link.to, '/recuperar-senha');
  assert.doesNotMatch(JSON.stringify(result), /malicious/);
});

test('provider failures and unapproved articles fall back without leaking errors', async () => {
  for (const fetchImpl of [async () => new Response('provider secret error', { status: 500 }), async () => new Response(JSON.stringify({ status: 'incomplete' })), async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"article_id":"enviar-documento","needs_human":false}' }] }] }))]) {
    const result = await answerSupportQuestion({ question: 'Minha senha', category: 'acesso', enabled: true, apiKey: 'test', model: 'test', fetchImpl });
    assert.equal(result.mode, 'guide');
    assert.doesNotMatch(JSON.stringify(result), /secret error/);
  }
});

function mailClient(rpc, requester = { nome: 'Pessoa de Teste', email: 'pessoa@example.invalid' }, error = null) {
  return { rpc, from(table) {
    assert.equal(table, 'funcionarios');
    return { select(fields) { assert.equal(fields, 'nome,email'); return this; }, eq(field, id) { assert.equal(field, 'id'); assert.equal(id, 'employee-id'); return this; }, async maybeSingle() { return { data: requester, error }; } };
  } };
}

test('reply links address the requester and encode the ticket subject safely', () => {
  const description='Preciso de ajuda com o ponto.\nO problema ocorreu na saída.';
  const link = new URL(getSupportReplyUrl({ protocol: 42, subject: 'Ponto & horário?\r\nBcc: attacker@example.invalid', description, employee: { nome:'Pessoa de Teste',email: 'pessoa+suporte@example.invalid' } }));
  assert.equal(decodeURIComponent(link.pathname), 'pessoa+suporte@example.invalid');
  assert.match(link.searchParams.get('subject'), /Chamado #42/);
  assert.doesNotMatch(link.searchParams.get('subject'), /[\r\n]/);
  assert.deepEqual([...link.searchParams.keys()], ['subject','body']);
  assert.ok(link.searchParams.get('body').includes(description));
  assert.match(link.searchParams.get('body'),/Olá, Pessoa de Teste\.[\s\S]*chamado #42/);
  for (const email of ['', 'invalid', 'pessoa@example.invalid\r\nBcc:evil@example.invalid']) assert.equal(getSupportReplyUrl({ employee: { email } }), null);
  assert.equal(getSupportReplyUrl(null), null);
});

test('mail remains off without configuration and quota failures cannot send', async () => {
  const fetchImpl = () => { throw new Error('External request forbidden'); };
  assert.equal(await notifySupportTeam({ config: { enabled: false }, fetchImpl }), 'not_configured');
  assert.equal(await notifySupportTeam({ ticket: { funcionario_id: 'employee-id' }, config: { enabled: true, apiKey: 'test', to: 'support@example.invalid', from: 'sender@example.invalid' }, client: mailClient(async () => ({ data: { allowed: false } })), fetchImpl }), 'pending');
});

test('mail includes the saved requester identity and reply address with persistent idempotency', async () => {
  const calls = [];
  const client = mailClient(async (name, args) => {
    calls.push({ name, args });
    return { data: name === 'consume_support_quota' ? { allowed: true } : true, error: null };
  });
  const result = await notifySupportTeam({ client, ticket: { id: 'ticket-id', funcionario_id: 'employee-id', protocol: 42, category: 'acesso', description: 'private question', employee: { nome: 'Forged', email: 'attacker@example.invalid' } }, actorId: 'verified', config: { enabled: true, apiKey: 'test', to: 'support@example.invalid', from: 'sender@example.invalid' }, fetchImpl: async (_url, options) => {
    assert.equal(options.headers['Idempotency-Key'], 'support-ticket-ticket-id');
    const message = JSON.parse(options.body);
    assert.equal(message.reply_to, 'pessoa@example.invalid');
    assert.match(message.text, /Solicitante: Pessoa de Teste/);
    assert.match(message.text, /E-mail: pessoa@example.invalid/);
    assert.match(message.text, /Mensagem:\nprivate question/);
    assert.deepEqual(message.to, ['support@example.invalid']);
    assert.doesNotMatch(options.body, /attacker@example.invalid|Forged/);
    return new Response('{}');
  } });
  assert.equal(result, 'sent');
  assert.deepEqual(calls.map((item) => item.name), ['consume_support_quota','claim_support_email','finish_support_email']);
  assert.equal(calls[2].args.p_success, true);
});

test('failed mail is recorded for retry without failing the saved ticket', async () => {
  let finished = false;
  const client = mailClient(async (name, args) => {
    if (name === 'finish_support_email') { finished = true; assert.equal(args.p_success, false); }
    return { data: name === 'consume_support_quota' ? { allowed: true } : true, error: null };
  });
  assert.equal(await notifySupportTeam({ client, ticket: { id: 'ticket', funcionario_id: 'employee-id', protocol: 1 }, actorId: 'actor', config: { enabled: true, apiKey: 'test', to: 'support@example.invalid', from: 'sender@example.invalid' }, fetchImpl: async () => { throw new Error('timeout'); } }), 'pending');
  assert.equal(finished, true);
});

test('missing or invalid requester contact never claims or sends a notification', async () => {
  const forbidden = () => { throw new Error('No side effects allowed'); };
  for (const requester of [null, { nome: 'Pessoa' }, { nome: '', email: 'pessoa@example.invalid' }, { nome: 'Pessoa', email: 'a@example.invalid\r\nBcc:b@example.invalid' }]) {
    assert.equal(await notifySupportTeam({ client: mailClient(forbidden, requester), ticket: { funcionario_id: 'employee-id' }, config: { enabled: true, apiKey: 'test', to: 'support@example.invalid', from: 'sender@example.invalid' }, fetchImpl: forbidden }), 'pending');
  }
});
