import { addIsoDays, calcDuration } from './utils.js';

const MINIMUM_REST_MS = 11 * 60 * 60 * 1000;

function punchTimestamp(date, time) {
  return Date.parse(`${date}T${time}-03:00`);
}

export function getIntershiftRestWarning(records, entryDate, entryTime, now) {
  const entry = entryTime ? punchTimestamp(entryDate, entryTime) : now.getTime();
  let previousExit = -Infinity;

  for (const record of records) {
    if (!record.saida || record.data >= entryDate) continue;
    const legacyOvernight = !record.saida_data && record.entrada
      && punchTimestamp(record.data, record.saida) < punchTimestamp(record.data, record.entrada);
    const exitDate = record.saida_data || (legacyOvernight ? addIsoDays(record.data, 1) : record.data);
    const exit = punchTimestamp(exitDate, record.saida);
    if (exit > previousExit) previousExit = exit;
  }

  const availableAt = previousExit + MINIMUM_REST_MS;
  if (!Number.isFinite(previousExit) || !Number.isFinite(entry) || entry >= availableAt) return null;
  return {
    availableAt: new Date(Math.ceil(availableAt / 1000) * 1000),
    duration: calcDuration(previousExit, Math.max(entry, previousExit)),
  };
}
