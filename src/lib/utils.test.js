import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcDailyTotal,
  calcElapsedDailyTotal,
  calcNightAdjustedMilliseconds,
  formatDate,
  formatMinutesAsHours,
  getElapsedWorkMinutes,
  getExpectedShiftMinutes,
  isValidDateRange,
  getMonthRangeForDateInSP,
  getWeekRangeForDateInSP,
  validateCPF,
} from './utils.js';

test('validates CPF check digits and rejects repeated digits', () => {
  assert.equal(validateCPF('529.982.247-25'), true);
  assert.equal(validateCPF('111.111.111-11'), false);
  assert.equal(validateCPF('123'), false);
});

test('formats calendar dates in São Paulo without shifting the day', () => {
  assert.equal(formatDate('2026-10-15'), '15/10/2026');
  assert.equal(formatDate('2026-10-15T00:00:00'), '15/10/2026');
});

test('builds Monday-to-Sunday ranges across month and year boundaries', () => {
  assert.deepEqual(getWeekRangeForDateInSP('2026-01-01'), {
    start: '2025-12-29', end: '2026-01-04',
  });
  assert.deepEqual(getWeekRangeForDateInSP('2026-10-18'), {
    start: '2026-10-12', end: '2026-10-18',
  });
});

test('builds month ranges including leap years', () => {
  assert.deepEqual(getMonthRangeForDateInSP('2024-02-15'), {
    start: '2024-02-01', end: '2024-02-29',
  });
  assert.deepEqual(getMonthRangeForDateInSP('2026-02-15'), {
    start: '2026-02-01', end: '2026-02-28',
  });
});

test('validates custom date ranges and rejects reversed or impossible dates', () => {
  assert.equal(isValidDateRange('2026-10-01', '2026-10-17'), true);
  assert.equal(isValidDateRange('2026-10-17', '2026-10-17'), true);
  assert.equal(isValidDateRange('2026-10-18', '2026-10-17'), false);
  assert.equal(isValidDateRange('2026-02-29', '2026-03-01'), false);
  assert.equal(isValidDateRange('', '2026-10-17'), false);
});

test('keeps a 59-minute remainder instead of rounding it to a full hour', () => {
  assert.equal(formatMinutesAsHours(59), '0h 59min');
  assert.equal(formatMinutesAsHours(119), '1h 59min');
  assert.equal(formatMinutesAsHours(120), '2h');
});

test('applies the reduced night-hour credit only to work inside the night window', () => {
  assert.equal(calcNightAdjustedMilliseconds('2026-10-15', '21:00', '2026-10-15', '22:00'), 60 * 60 * 1000);
  assert.equal(calcNightAdjustedMilliseconds('2026-10-15', '22:00', '2026-10-15', '23:00'), 60 * 60 * 1000 * 8 / 7);
});

test('computes CLT hours using the fixed lunch window for a weekday', () => {
  assert.equal(calcDailyTotal({
    data: '2026-10-15', entrada: '08:00:00', saida: '17:00:00',
    saida_almoco: null, retorno_almoco: null, turno_trabalhado: 'turno1',
  }), '8h');
});

test('computes PJ elapsed hours across midnight and subtracts a marked break', () => {
  const record = {
    data: '2026-10-15', entrada: '22:00:00', saida: '06:00:00', saida_data: '2026-10-16',
    saida_almoco: '02:00:00', retorno_almoco: '03:00:00',
  };
  assert.equal(getElapsedWorkMinutes(record), 7 * 60);
  assert.equal(calcElapsedDailyTotal(record), '7h');
});

test('configured turno 3 adds up to 44 credited hours from Monday through Saturday', () => {
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
  const weeklyMinutes = dates.reduce((sum, data) => sum + getExpectedShiftMinutes({ data }, 'turno3'), 0);
  assert.ok(Math.abs(weeklyMinutes - 44 * 60) < 1);
});

test('configured turno 2 adds up to 44 credited hours from Monday through Saturday', () => {
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
  const weeklyMinutes = dates.reduce((sum, data) => sum + getExpectedShiftMinutes({ data }, 'turno2'), 0);
  assert.ok(Math.abs(weeklyMinutes - 44 * 60) < 1);
});

test('does not calculate completed daily totals for open shifts', () => {
  assert.equal(calcElapsedDailyTotal({ data: '2026-10-15', entrada: '08:00:00' }), '—');
});
