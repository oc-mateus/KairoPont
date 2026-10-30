export const WORK_SHIFTS = {
  turno1: { id: 'turno1', label: '06:00–15:00', start: '06:00', end: '15:00', lunchOut: '12:00', lunchReturn: '13:00' },
  turno2: { id: 'turno2', label: '08:00–17:00', start: '08:00', end: '17:00', lunchOut: '12:00', lunchReturn: '13:00' },
  turno3: { id: 'turno3', label: '14:00–22:52', start: '14:00', end: '22:52', lunchOut: '18:00', lunchReturn: '19:00' },
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

export function makeHabitualSchedule(shiftId) {
  const shift = WORK_SHIFTS[shiftId];
  if (!shift) return null;
  return {
    id: shift.id,
    entrada: shift.start,
    saida_almoco: shift.lunchOut || null,
    retorno_almoco: shift.lunchReturn || null,
    saida: shift.end,
  };
}

export function getHabitualSchedules(schedule) {
  if (Array.isArray(schedule?.horarios_habituais) && schedule.horarios_habituais.length) {
    return schedule.horarios_habituais
      .filter((item) => item?.entrada && item?.saida)
      .map((item) => WORK_SHIFTS[item.id] ? makeHabitualSchedule(item.id) : item);
  }

  // Read older per-day schedules and collapse matching entries into a reusable list.
  const legacyItems = Object.values(schedule?.horarios_por_dia || {}).filter((item) => item?.entrada && item?.saida);
  const legacyItemsWithFallback = legacyItems.length ? legacyItems : (schedule?.entrada && schedule?.saida ? [schedule] : []);
  const uniqueIds = [...new Set(legacyItemsWithFallback.map((item) => inferShiftFromEntry(item.entrada)).filter(Boolean))];
  if (uniqueIds.length) return uniqueIds.map(makeHabitualSchedule).filter(Boolean);
  const assignedId = WORK_SHIFTS[schedule?.turno_id || schedule?.tipo] ? (schedule.turno_id || schedule.tipo) : null;
  return assignedId ? [makeHabitualSchedule(assignedId)] : [];
}

export function getRegisteredScheduleLabel(schedule) {
  const habituals = getHabitualSchedules(schedule);
  if (!habituals.length) return 'Horário não informado';
  return habituals.map((item) => getShiftLabel(item.id || inferShiftFromEntry(item.entrada))).join(' · ');
}

function toMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

const MINUTES_PER_DAY = 24 * 60;

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
  const candidates = getHabitualSchedules(schedule);
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
    : (getHabitualSchedules(schedule)[0]?.id || inferShiftFromEntry(getHabitualSchedules(schedule)[0]?.entrada));
}

export function makeEmployeeSchedule(shiftId) {
  const shift = WORK_SHIFTS[shiftId] || WORK_SHIFTS.turno1;
  return { tipo: shift.id, turno_id: shift.id, dias_semana: [1, 2, 3, 4, 5, 6], horarios_habituais: [makeHabitualSchedule(shift.id)] };
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
