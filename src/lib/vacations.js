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

export function getActiveVacationNotices(notifications, requests) {
  const resolved = new Set();
  for (const request of requests) {
    if (request.status === 'aprovada') {
      resolved.add(`ferias-prazo:${request.periodo_id}`);
      resolved.add(`ferias-vencidas:${request.periodo_id}`);
    }
  }
  return notifications.filter((notification) => !notification.lida_em && !resolved.has(notification.referencia));
}
