import test from 'node:test';
import assert from 'node:assert/strict';
import { addIsoDays } from './utils.js';
import { getActiveVacationNotices, getVacationRequestWindow } from './vacations.js';

test('vacation window includes the full stay and respects the saved abono', () => {
  const period = { dias_direito: 30, dias_abono: 0, prazo_concessivo: '2026-12-27' };
  const today = '2026-11-12';
  const closed = getVacationRequestWindow(period, today);
  assert.deepEqual(closed, { duration: 30, firstDeparture: '2026-12-12', lastDeparture: '2026-11-28' });

  const onlyDay = getVacationRequestWindow({ ...period, dias_abono: 10, prazo_concessivo: '2026-12-31' }, today);
  assert.equal(onlyDay.firstDeparture, onlyDay.lastDeparture);
  assert.equal(addIsoDays(onlyDay.firstDeparture, onlyDay.duration), '2027-01-01');
});

test('approval hides both deadline notices only for the matching vacation period', () => {
  const notifications = [
    { referencia: 'ferias-prazo:approved' },
    { referencia: 'ferias-vencidas:approved' },
    { referencia: 'ferias-prazo:refused' },
    { referencia: 'ferias-vencidas:another' },
    { referencia: 'ferias-prazo:read', lida_em: '2026-11-12T12:00:00Z' },
  ];
  const requests = [
    { status: 'aprovada', periodo_id: 'approved' },
    { status: 'recusada', periodo_id: 'refused' },
  ];
  assert.deepEqual(getActiveVacationNotices(notifications, requests), notifications.slice(2, 4));
});
