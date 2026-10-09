export const WORK_SHIFTS = {
  turno1: { id: 'turno1', label: '1º turno', start: '08:00', end: '17:00', lunchOut: '12:00', lunchReturn: '13:00' },
  turno2: { id: 'turno2', label: '2º turno', start: '14:00', end: '22:52', lunchOut: '19:30', lunchReturn: '20:30' },
  turno3: { id: 'turno3', label: '3º turno', start: '22:45', end: '06:15', overnight: true },
};

export function getShiftLabel(id) {
  return WORK_SHIFTS[id]?.label || 'Turno não identificado';
}

function toMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

const MINUTES_PER_DAY = 24 * 60;
const WEEKLY_WORK_MINUTES = 44 * 60;

function creditedMinutesForInterval(startMinute, endMinute) {
  let end = endMinute;
  if (end <= startMinute) end += MINUTES_PER_DAY;
  const elapsed = end - startMinute;
  let nightMinutes = 0;
  const firstNightDay = Math.floor(startMinute / MINUTES_PER_DAY) - 1;
  const lastNightDay = Math.floor(end / MINUTES_PER_DAY);
  for (let day = firstNightDay; day <= lastNightDay; day += 1) {
    const nightStart = day * MINUTES_PER_DAY + 22 * 60;
    const nightEnd = day * MINUTES_PER_DAY + MINUTES_PER_DAY + 5 * 60;
    nightMinutes += Math.max(0, Math.min(end, nightEnd) - Math.max(startMinute, nightStart));
  }
  return elapsed + nightMinutes / 7;
}

function creditedMinutesForShift(shift) {
  const entry = toMinutes(shift.start);
  const exit = toMinutes(shift.end);
  if (entry == null || exit == null) return 0;
  if (shift.lunchOut && shift.lunchReturn) {
    return creditedMinutesForInterval(entry, toMinutes(shift.lunchOut))
      + creditedMinutesForInterval(toMinutes(shift.lunchReturn), exit);
  }
  return creditedMinutesForInterval(entry, exit);
}

function saturdayHoursForShift(shift) {
  if (shift.id === 'turno2') {
    return { entrada: '14:30', saida_almoco: null, retorno_almoco: null, saida: '18:30' };
  }
  const entry = toMinutes(shift.start);
  const remainingCredits = Math.max(0, WEEKLY_WORK_MINUTES - 5 * creditedMinutesForShift(shift));
  let minutesStillNeeded = remainingCredits;
  let elapsedMinutes = 0;
  while (minutesStillNeeded > 1e-7) {
    const currentMinute = entry + elapsedMinutes;
    const minuteOfDay = ((currentMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const dayStart = Math.floor(currentMinute / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    const inNightPeriod = minuteOfDay >= 22 * 60 || minuteOfDay < 5 * 60;
    const nextBoundary = inNightPeriod
      ? (minuteOfDay >= 22 * 60 ? dayStart + MINUTES_PER_DAY + 5 * 60 : dayStart + 5 * 60)
      : (minuteOfDay < 22 * 60 ? dayStart + 22 * 60 : dayStart + MINUTES_PER_DAY + 22 * 60);
    const rate = inNightPeriod ? 8 / 7 : 1;
    const availableMinutes = Math.max(1, nextBoundary - currentMinute);
    const availableCredits = availableMinutes * rate;
    const usedMinutes = Math.min(availableMinutes, minutesStillNeeded / rate);
    elapsedMinutes += usedMinutes;
    minutesStillNeeded -= Math.min(availableCredits, minutesStillNeeded);
  }
  const exitMinute = (entry + Math.round(elapsedMinutes)) % MINUTES_PER_DAY;
  const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return { entrada: shift.start, saida_almoco: null, retorno_almoco: null, saida: clock(exitMinute) };
}

// Classifica pela hora de entrada mais próxima do início dos turnos, considerando a virada do dia.
export function inferShiftFromEntry(value) {
  const entry = toMinutes(value);
  if (entry == null) return null;
  return Object.values(WORK_SHIFTS).reduce((closest, shift) => {
    const start = toMinutes(shift.start);
    const rawDistance = Math.abs(entry - start);
    const distance = Math.min(rawDistance, 1440 - rawDistance);
    return distance < closest.distance ? { id: shift.id, distance } : closest;
  }, { id: null, distance: Infinity }).id;
}

export function getAssignedShiftId(schedule) {
  const savedId = schedule?.turno_id || schedule?.tipo;
  return WORK_SHIFTS[savedId]
    ? savedId
    : inferShiftFromEntry(schedule?.horarios_por_dia?.['1']?.entrada || schedule?.entrada);
}

export function makeEmployeeSchedule(shiftId) {
  const shift = WORK_SHIFTS[shiftId] || WORK_SHIFTS.turno1;
  const weekdays = Object.fromEntries([1, 2, 3, 4, 5].map((day) => [String(day), {
    entrada: shift.start,
    saida_almoco: shift.lunchOut || null,
    retorno_almoco: shift.lunchReturn || null,
    saida: shift.end,
  }]));
  weekdays['6'] = saturdayHoursForShift(shift);
  return { tipo: shift.id, turno_id: shift.id, dias_semana: [1, 2, 3, 4, 5, 6], horarios_por_dia: weekdays };
}

export function inferShiftForRecord(record, assignedShiftId) {
  return record?.turno_trabalhado || inferShiftFromEntry(record?.entrada) || assignedShiftId || null;
}

export function summarizeWorkedShifts(records = []) {
  const summary = { turno1: 0, turno2: 0, turno3: 0, unidentified: 0 };
  records.forEach((record) => {
    const shiftId = record?.turno_trabalhado || inferShiftFromEntry(record?.entrada);
    if (Object.hasOwn(summary, shiftId)) summary[shiftId] += 1;
    else summary.unidentified += 1;
  });
  return summary;
}
