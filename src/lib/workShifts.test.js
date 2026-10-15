import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFixedLunchLabel,
  getLunchLabelForRecord,
  inferShiftFromEntry,
  makeEmployeeSchedule,
} from './workShifts.js';

test('classifies entries near each fixed shift, including midnight wraparound', () => {
  assert.equal(inferShiftFromEntry('08:10'), 'turno1');
  assert.equal(inferShiftFromEntry('14:05'), 'turno2');
  assert.equal(inferShiftFromEntry('22:40'), 'turno3');
  assert.equal(inferShiftFromEntry('00:10'), 'turno3');
  assert.equal(inferShiftFromEntry(null), null);
});

test('marks weekends without a fixed lunch break', () => {
  assert.equal(getFixedLunchLabel('turno1', '2026-10-15'), '12:00–13:00');
  assert.equal(getFixedLunchLabel('turno1', '2026-10-17'), 'Sem intervalo');
});

test('labels a recorded overnight meal break on the following day', () => {
  assert.equal(getLunchLabelForRecord({
    data: '2026-10-15', entrada: '22:45:00', saida_almoco: '02:00:00', retorno_almoco: '03:00:00',
  }, 'turno3'), '02:00–03:00 (dia seguinte)');
});

test('builds the configured Saturday schedules for each shift', () => {
  assert.equal(makeEmployeeSchedule('turno1').horarios_por_dia['6'].saida, '12:00');
  assert.equal(makeEmployeeSchedule('turno2').horarios_por_dia['6'].entrada, '14:30');
  assert.equal(makeEmployeeSchedule('turno2').horarios_por_dia['6'].saida, '18:33');
  assert.equal(makeEmployeeSchedule('turno3').horarios_por_dia['6'].saida, '05:36');
});
