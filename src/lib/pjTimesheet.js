import { formatMinutesAsHours, getElapsedWorkMinutes, getPunchContract, getTodayInSP } from './utils.js';

const localTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const MAX_OPEN_SHIFT_MS = 24 * 60 * 60 * 1000;

// Open shifts can span midnight. Older missing exits require correction.
export function getPjTimesheetSnapshot(records, downloadedAt, currentContract) {
  const date = getTodayInSP(downloadedAt);
  const clock = `${localTime.format(downloadedAt)}.${String(downloadedAt.getUTCMilliseconds()).padStart(3, '0')}`;
  const cutoff = Date.parse(`${date}T${clock}Z`);
  let latestRecord;
  let latestStart = -Infinity;
  for (const record of records) {
    const start = Date.parse(`${record.data}T${record.entrada}Z`);
    if (start > latestStart && start <= cutoff) {
      latestRecord = record;
      latestStart = start;
    }
  }
  let closedMinutes = 0;
  let provisionalMinutes = null;
  const rows = new Map();

  for (const record of records) {
    if (getPunchContract(record, currentContract) !== 'pj') continue;
    const start = Date.parse(`${record.data}T${record.entrada}Z`);
    const exit = Date.parse(`${record.saida_data || record.data}T${record.saida}Z`);
    if (start <= exit && exit <= cutoff) {
      const minutes = getElapsedWorkMinutes(record);
      rows.set(record, { hours: formatMinutesAsHours(minutes), status: 'Completo' });
      closedMinutes += minutes;
      continue;
    }

    if (record === latestRecord && !record.saida && cutoff - start < MAX_OPEN_SHIFT_MS) {
      const minutes = getElapsedWorkMinutes({ ...record, saida: clock, saida_data: date });
      rows.set(record, { hours: formatMinutesAsHours(minutes), status: 'Em andamento*', hideExit: true });
      provisionalMinutes = minutes;
    } else {
      rows.set(record, { hours: '—', status: 'Incompleto', hideExit: exit > cutoff });
    }
  }

  return { rows, closedMinutes, provisionalMinutes };
}

export function pjPdfHoursDetails(snapshot) {
  const { closedMinutes, provisionalMinutes } = snapshot;
  return [
    `Total de horas PJ até a emissão: ${formatMinutesAsHours(closedMinutes + (provisionalMinutes ?? 0))}`,
    ...(provisionalMinutes !== null ? [
      `*Inclui ${formatMinutesAsHours(provisionalMinutes)} provisórias da jornada em andamento, sujeitas à marcação de saída.`,
    ] : []),
  ];
}
