import { addIsoDays } from './utils.js';

export function getVacationRequestWindow(period, today) {
  const duration = period.dias_direito - (Number(period.dias_abono) || 0);
  return {
    duration,
    firstDeparture: addIsoDays(today, 30),
    // The deadline includes the last day off. The return is the following day.
    lastDeparture: addIsoDays(period.prazo_concessivo, 1 - duration),
  };
}

export function getActiveVacationNotices(notifications, requests, periods = []) {
  const resolvedPeriods = [
    ...requests.filter(({ status }) => status === 'aprovada').map(({ periodo_id }) => periodo_id),
    ...periods.filter(({ substituido_em }) => substituido_em).map(({ id }) => id),
  ];
  const resolved = new Set(resolvedPeriods.flatMap((id) => [`ferias-prazo:${id}`, `ferias-vencidas:${id}`]));
  return notifications.filter((notification) => !notification.lida_em && !resolved.has(notification.referencia));
}
