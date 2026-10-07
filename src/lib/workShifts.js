export const WORK_SHIFTS = {
  turno1: { id: 'turno1', label: '1º turno', start: '08:00', end: '17:00', lunchOut: '12:00', lunchReturn: '13:00' },
  turno2: { id: 'turno2', label: '2º turno', start: '14:00', end: '22:45' },
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
  weekdays['6'] = { entrada: '08:00', saida_almoco: null, retorno_almoco: null, saida: '12:00' };
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
