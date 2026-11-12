import test from 'node:test';
import assert from 'node:assert/strict';
import { getIntershiftRestWarning } from './intershiftRest.js';

const previous = { data: '2026-11-11', entrada: '14:00:00', saida: '22:00:00', saida_data: '2026-11-11' };
const today = '2026-11-12';

test('the warning clears at 11 hours, including seconds and fractions of a second', () => {
  const records = [{ ...previous, saida: '22:00:30.250000' }];
  const early = new Date('2026-11-12T09:00:30.249-03:00');
  const enough = new Date('2026-11-12T09:00:30.250-03:00');
  assert.equal(getIntershiftRestWarning(records, today, null, early).availableAt.toISOString(), '2026-11-12T12:00:31.000Z');
  assert.equal(getIntershiftRestWarning(records, today, null, enough), null);
});

test('a recorded entry keeps its actual short-rest warning after the clock moves on', () => {
  const later = new Date('2026-11-12T17:00:00-03:00');
  assert.equal(getIntershiftRestWarning([previous], today, '08:00:00', later).duration, '10h 00min');
  assert.equal(getIntershiftRestWarning([previous], today, '09:00:00', later), null);
});

test('overnight exits count on their actual date, including legacy punches', () => {
  const overnight = { data: '2026-11-10', entrada: '22:00:00', saida: '23:00:00', saida_data: '2026-11-11' };
  const older = { ...previous, saida: '22:30:00' };
  const now = new Date('2026-11-12T08:00:00-03:00');
  assert.equal(getIntershiftRestWarning([older, overnight], today, null, now).duration, '9h 00min');

  const legacy = { data: '2026-11-11', entrada: '22:00:00', saida: '05:00:00' };
  assert.equal(getIntershiftRestWarning([legacy], today, null, now).duration, '3h 00min');
});

test('no previous exit, a same-day record, and full days off do not trigger an alert', () => {
  const now = new Date('2026-11-12T06:00:00-03:00');
  const records = [
    { ...previous, data: '2026-11-10', saida_data: '2026-11-10' },
    { ...previous, saida: null },
    { ...previous, data: today, saida_data: today },
  ];
  assert.equal(getIntershiftRestWarning(records, today, null, now), null);
});
