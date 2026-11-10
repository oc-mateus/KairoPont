import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityPolicy } from './security-policy.mjs';

test('production policy blocks injected scripts and arbitrary external connections', () => {
  const policy = createSecurityPolicy('https://project.supabase.co');
  assert.match(policy, /script-src 'self';/);
  assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  assert.match(policy, /connect-src 'self' https:\/\/project.supabase.co wss:\/\/project.supabase.co/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.throws(() => createSecurityPolicy('javascript:alert(1)'));
});
