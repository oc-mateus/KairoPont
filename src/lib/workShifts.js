export const WORK_SHIFTS = {
  turno1: { id: 'turno1', label: '06:00–15:00', start: '06:00', end: '15:00', lunchOut: '12:00', lunchReturn: '13:00' },
  turno2: { id: 'turno2', label: '08:00–17:00', start: '08:00', end: '17:00', lunchOut: '12:00', lunchReturn: '13:00' },
  turno3: { id: 'turno3', label: '14:00–22:00', start: '14:00', end: '22:00', lunchOut: '18:00', lunchReturn: '19:00' },
};

export function getFixedLunchSchedule(shiftId) {
  const shift = WORK_SHIFTS[shiftId];
  if (!shift?.lunchOut || !shift?.lunchReturn) return null;
  return { start: shift.lunchOut, end: shift.lunchReturn, nextDay: Boolean(shift.lunchNextDay) };
}

export function getFixedLunchLabel(shiftId, workDate = null) {
  if (workDate) {
    const weekday = new Date(`${workDate}T12:00:00`).getDay() || 7;
    if (weekday === 6 || weekday === 7) return 'Sem intervalo';
  }
  const lunch = getFixedLunchSchedule(shiftId);
  if (!lunch) return 'Sem intervalo';
  return `${lunch.start}–${lunch.end}${lunch.nextDay ? ' (dia seguinte)' : ''}`;
}

export function getLunchLabelForRecord(record, shiftId = null) {
  if (record?.saida_almoco && record?.retorno_almoco) {
    const start = String(record.saida_almoco).slice(0, 5);
    const end = String(record.retorno_almoco).slice(0, 5);
    const isNextDay = toMinutes(record.saida_almoco) < toMinutes(record.entrada)
      || toMinutes(record.retorno_almoco) < toMinutes(record.saida_almoco);
    return `${start}–${end}${isNextDay ? ' (dia seguinte)' : ''}`;
  }
  if (record?.saida_almoco || record?.retorno_almoco) return 'Intervalo incompleto';
  return getFixedLunchLabel(shiftId || inferShiftFromEntry(record?.entrada), record?.data);
}

export function getShiftLabel(id) {
  return WORK_SHIFTS[id]?.label || 'Horário não identificado';
}

export function getRegisteredScheduleLabel(schedule) {
  const registeredStarts = [...new Set(Object.values(schedule?.horarios_por_dia || {})
    .map((item) => toMinutes(item?.entrada))
    .filter((minute) => minute != null)
    .map((minute) => (Math.round(minute / 60) * 60) % MINUTES_PER_DAY))];
  if (registeredStarts.length > 1) return 'Horários variados';
  return getShiftLabel(getAssignedShiftId(schedule));
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
  if (shift.id === 'turno3') {
    return { entrada: '14:00', saida_almoco: null, retorno_almoco: null, saida: '18:00' };
  }
  const exitMinute = (toMinutes(shift.start) + 4 * 60) % MINUTES_PER_DAY;
  const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return { entrada: shift.start, saida_almoco: null, retorno_almoco: null, saida: clock(exitMinute) };
}

// Classifica pela entrada cadastrada mais próxima, arredondando a previsão à hora cheia.
export function inferShiftFromEntry(value) {
  const entry = toMinutes(value);
  if (entry == null) return null;
  return Object.values(WORK_SHIFTS).reduce((closest, shift) => {
    const rawStart = toMinutes(shift.start);
    const start = (Math.round(rawStart / 60) * 60) % 1440;
    const rawDistance = Math.abs(entry - start);
    const distance = Math.min(rawDistance, 1440 - rawDistance);
    return distance < closest.distance ? { id: shift.id, distance } : closest;
  }, { id: null, distance: Infinity }).id;
}

export function getNearestRegisteredSchedule(schedule, entry) {
  const actual = toMinutes(entry);
  if (actual == null) return null;
  const daySchedules = Object.values(schedule?.horarios_por_dia || {}).filter((item) => item?.entrada);
  const candidates = daySchedules.length ? daySchedules : (schedule?.entrada ? [schedule] : []);
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => {
    const expectedRaw = toMinutes(item.entrada);
    const expected = (Math.round(expectedRaw / 60) * 60) % MINUTES_PER_DAY;
    const rawDistance = Math.abs(actual - expected);
    const distance = Math.min(rawDistance, MINUTES_PER_DAY - rawDistance);
    return distance < best.distance ? { item, expected, distance } : best;
  }, { item: null, expected: null, distance: Infinity });
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
