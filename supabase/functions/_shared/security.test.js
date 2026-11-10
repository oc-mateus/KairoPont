import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceRateLimit, HttpError, readJsonObject, requestSecurity, stringField, uuidField } from './security.mjs';

const request = (body, headers = {}) => new Request('https://example.invalid', {
  method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers },
});
const rejectsWith = (status) => (error) => error instanceof HttpError && error.status === status;

test('CORS allows the application and rejects lookalike domains', () => {
  const req = request('{}', { Origin: 'https://oc-mateus.github.io' });
  const { reply, earlyResponse } = requestSecurity(req);
  assert.equal(earlyResponse, null);
  assert.equal(reply({}).headers.get('Access-Control-Allow-Origin'), 'https://oc-mateus.github.io');
  for (const origin of ['null', 'https://oc-mateus.github.io.attacker.invalid', 'https://evil.invalid']) {
    const { earlyResponse: denied } = requestSecurity(request('{}', { Origin: origin }));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('preflight is handled and methods other than POST are blocked', () => {
  assert.equal(requestSecurity(new Request('https://example.invalid', { method: 'OPTIONS' })).earlyResponse.status, 204);
  assert.equal(requestSecurity(new Request('https://example.invalid')).earlyResponse.status, 405);
});

test('JSON rejects mass assignment, primitives and malformed bodies', async () => {
  for (const body of ['null', '[]', 'true', '42', '"text"', '{', '{"nome":"Teste","role":"admin"}', '{"__proto__":{"role":"admin"}}']) {
    await assert.rejects(readJsonObject(request(body), ['nome']), rejectsWith(400));
  }
  assert.deepEqual(await readJsonObject(request('{"nome":"Teste"}'), ['nome']), { nome: 'Teste' });
  await assert.rejects(readJsonObject(request('{}', { 'Content-Type': 'text/plain' }), []), rejectsWith(415));
});

test('request size is enforced on actual UTF-8 bytes without trusting Content-Length', async () => {
  await assert.rejects(readJsonObject(request('{"nome":"áááá"}', { 'Content-Length': '1' }), ['nome'], 15), rejectsWith(413));
  await assert.rejects(readJsonObject(request('x'.repeat(16385)), []), rejectsWith(413));
});

test('fields reject objects, oversized values and invalid identifiers', () => {
  assert.throws(() => stringField({ nome: { role: 'admin' } }, 'nome', 150), rejectsWith(400));
  assert.throws(() => stringField({ nome: 'x'.repeat(151) }, 'nome', 150), rejectsWith(400));
  assert.equal(stringField({ data_admissao: null }, 'data_admissao', 10, true), '');
  assert.throws(() => uuidField({ id: 'not-a-uuid' }, 'id'), rejectsWith(400));
  assert.equal(uuidField({ id: '12345678-1234-1234-1234-123456789012' }, 'id'), '12345678-1234-1234-1234-123456789012');
});

test('rate limiting returns 429 with Retry-After and uses the authenticated actor', async () => {
  const { reply } = requestSecurity(request('{}'));
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'consume_edge_rate_limit');
    assert.deepEqual(args, { p_action: 'invite-employee', p_actor_id: 'verified-user' });
    return { data: { allowed: false, retry_after: 42 }, error: null };
  } };
  const denied = await enforceRateLimit(client, 'invite-employee', 'verified-user', reply);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('Retry-After'), '42');
  assert.equal(denied.headers.get('Cache-Control'), 'no-store');
});

test('unavailable or malformed quota checks fail closed', async () => {
  const { reply } = requestSecurity(request('{}'));
  for (const result of [{ error: { message: 'database unavailable' } }, { data: null }, { data: { allowed: 'true' } }, { data: { allowed: false, retry_after: -1 } }]) {
    const response = await enforceRateLimit({ rpc: async () => result }, 'invite-employee', 'actor', reply);
    assert.equal(response.status, 503);
  }
  assert.equal((await enforceRateLimit({ rpc: async () => { throw new Error('offline'); } }, 'invite-employee', 'actor', reply)).status, 503);
  assert.equal(await enforceRateLimit({ rpc: async () => ({ data: { allowed: true } }) }, 'invite-employee', 'actor', reply), null);
});
