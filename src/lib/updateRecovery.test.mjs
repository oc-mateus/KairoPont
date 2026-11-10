import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverFromUpdate } from './updateRecovery.mjs';

test('a missing deployment chunk reloads once per build and never loops', () => {
  const values = new Map();
  let reloads = 0;
  let prevented = 0;
  const options = { online: true, storage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }, location: { reload: () => reloads++ }, buildId: 'old-bundle' };
  const event = { preventDefault: () => prevented++ };
  assert.equal(recoverFromUpdate(event, options), true);
  assert.equal(recoverFromUpdate(event, options), false);
  assert.equal(reloads, 1);
  assert.equal(prevented, 1);
  assert.equal(recoverFromUpdate(event, { ...options, buildId: 'next-bundle' }), true);
  assert.equal(reloads, 2);
});

test('offline users and unavailable storage retain the manual error recovery', () => {
  const options = { online: false, storage: { getItem() { throw Error('blocked'); } }, location: { reload() { assert.fail('unexpected reload'); } }, buildId: 'bundle' };
  const event = { preventDefault() { assert.fail('unexpected suppression'); } };
  assert.equal(recoverFromUpdate(event, options), false);
  assert.equal(recoverFromUpdate(event, { ...options, online: true }), false);
});
