/**
 * Utilitários de data/hora para o fuso America/Sao_Paulo
 */

import { getFixedLunchLabel, getFixedLunchSchedule, inferShiftForRecord, makeEmployeeSchedule } from './workShifts.js';

const TIMEZONE = 'America/Sao_Paulo';

/** Confere se duas datas ISO representam um intervalo de calendário válido. */
export function isValidDateRange(start, end) {
  const isCalendarDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  };

  return isCalendarDate(start) && isCalendarDate(end) && start <= end;
}

/**
 * Formata uma data ISO para exibição no fuso de São Paulo
 */
export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString('pt-BR', { timeZone: TIMEZONE });
}

/**
 * Formata apenas a hora de uma data ISO
 */
export function formatTime(timeString) {
  if (!timeString) return '—';
  if (timeString.includes('T')) {
    const date = new Date(timeString);
    return date.toLocaleTimeString('pt-BR', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  return timeString.replace(/^(\d{1,2}:\d{2}:\d{2})\.\d+$/, '$1'); // "08:00:00"
}

/**
 * Formata apenas a data de uma data ISO
 */
export function formatDate(isoString) {
  if (!isoString) return '—';
  const value = String(isoString);
  // Date-only values represent a São Paulo calendar date, not a UTC instant.
  const date = /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? new Date(`${value.slice(0, 10)}T12:00:00Z`)
    : new Date(value);
  return date.toLocaleDateString('pt-BR', { timeZone: TIMEZONE });
}

/**
 * Retorna a data atual no fuso de São Paulo (formato YYYY-MM-DD)
 */
export function getTodayInSP() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

/**
 * Retorna o início e fim da semana atual (segunda a domingo)
 */
export function getWeekRangeForDateInSP(dateValue) {
  const spDate = new Date(`${dateValue}T00:00:00Z`);
  const dayOfWeek = spDate.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(spDate);
  monday.setUTCDate(spDate.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

export function getCurrentWeekRange() {
  return getWeekRangeForDateInSP(getTodayInSP());
}

/**
 * Retorna o início e fim do mês atual
 */
export function getMonthRangeForDateInSP(dateValue) {
  const [year, month] = dateValue.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  
  return {
    start: firstDay.toISOString().split('T')[0],
    end: lastDay.toISOString().split('T')[0],
  };
}

export function getCurrentMonthRange() {
  return getMonthRangeForDateInSP(getTodayInSP());
}

/**
 * Calcula a diferença entre dois timestamps em formato legível (Xh Ym)
 */
export function calcDuration(startISO, endISO) {
  if (!startISO || !endISO) return '—';
  const diffMs = new Date(endISO) - new Date(startISO);
  if (diffMs < 0) return '—';
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  return `${hours}h ${String(minutes).padStart(2, '0')}min`;
}

function toUtcTimestamp(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = String(dateValue).slice(0, 10).split('-').map(Number);
  const [hour, minute, secondValue = '0'] = String(timeValue).split(':');
  const seconds = Number(secondValue);
  if (![year, month, day, Number(hour), Number(minute), seconds].every(Number.isFinite)) return null;
  const wholeSeconds = Math.floor(seconds);
  const milliseconds = Math.round((seconds - wholeSeconds) * 1000);
  return Date.UTC(year, month - 1, day, Number(hour), Number(minute), wholeSeconds, milliseconds);
}

/** Returns elapsed time with work between 22:00 and 05:00 counted as 52m30s per hour. */
export function calcNightAdjustedMilliseconds(startDate, startTime, endDate, endTime) {
  const start = toUtcTimestamp(startDate, startTime);
  const end = toUtcTimestamp(endDate, endTime);
  if (start == null || end == null || end <= start) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  const nightStartOffset = 22 * 60 * 60 * 1000;
  const nightEndOffset = 5 * 60 * 60 * 1000;
  let reducedNightMs = 0;
  const firstDay = Math.floor(start / dayMs) * dayMs - dayMs;
  const lastDay = Math.floor(end / dayMs) * dayMs;

  for (let dayStart = firstDay; dayStart <= lastDay; dayStart += dayMs) {
    const nightStart = dayStart + nightStartOffset;
    const nightEnd = dayStart + dayMs + nightEndOffset;
    reducedNightMs += Math.max(0, Math.min(end, nightEnd) - Math.max(start, nightStart));
  }

  return (end - start - reducedNightMs) + (reducedNightMs * 8 / 7);
}

function nextIsoDate(dateValue) {
  const [year, month, day] = String(dateValue).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function getRecordedLunchDates(record) {
  const entryMinutes = clockMinutes(record.entrada);
  const lunchOutMinutes = clockMinutes(record.saida_almoco);
  const lunchReturnMinutes = clockMinutes(record.retorno_almoco);
  let lunchDate = record.data;
  if (entryMinutes != null && lunchOutMinutes != null && lunchOutMinutes < entryMinutes) {
    lunchDate = nextIsoDate(lunchDate);
  }
  const returnDate = lunchReturnMinutes != null && lunchOutMinutes != null && lunchReturnMinutes < lunchOutMinutes
    ? nextIsoDate(lunchDate)
    : lunchDate;
  return { lunchDate, returnDate };
}

function dateAndTimeFromTimestamp(timestamp) {
  const value = new Date(timestamp).toISOString();
  return { date: value.slice(0, 10), time: value.slice(11, 19) };
}

/** CLT credit calculation, applying the fixed meal window when no legacy meal punches exist. */
export function calcCreditedDailyMilliseconds(record, shiftId = null) {
  if (!record?.entrada || !record?.saida) return 0;
  const shift = shiftId || inferShiftForRecord(record);
  let endDate = record.saida_data || record.data;
  if (!record.saida_data && clockMinutes(record.saida) <= clockMinutes(record.entrada)) endDate = nextIsoDate(record.data);

  if (record.saida_almoco || record.retorno_almoco) {
    let total = 0;
    const { lunchDate, returnDate } = getRecordedLunchDates(record);
    if (record.entrada && record.saida_almoco) {
      total += calcNightAdjustedMilliseconds(record.data, record.entrada, lunchDate, record.saida_almoco);
    }
    if (record.retorno_almoco && record.saida) {
      total += calcNightAdjustedMilliseconds(returnDate, record.retorno_almoco, endDate, record.saida);
    }
    return total;
  }

  const total = calcNightAdjustedMilliseconds(record.data, record.entrada, endDate, record.saida);
  const lunch = getFixedLunchLabel(shift, record.data) === 'Sem intervalo' ? null : getFixedLunchSchedule(shift);
  if (!lunch) return total;

  const start = toUtcTimestamp(record.data, record.entrada);
  const end = toUtcTimestamp(endDate, record.saida);
  const lunchDate = lunch.nextDay ? nextIsoDate(record.data) : record.data;
  const lunchStart = toUtcTimestamp(lunchDate, lunch.start);
  const lunchEnd = toUtcTimestamp(lunchDate, lunch.end);
  const overlapStart = Math.max(start, lunchStart);
  const overlapEnd = Math.min(end, lunchEnd);
  if (overlapEnd <= overlapStart) return total;

  const overlapStartParts = dateAndTimeFromTimestamp(overlapStart);
  const overlapEndParts = dateAndTimeFromTimestamp(overlapEnd);
  const lunchCredit = calcNightAdjustedMilliseconds(
    overlapStartParts.date, overlapStartParts.time, overlapEndParts.date, overlapEndParts.time,
  );
  return Math.max(0, total - lunchCredit);
}

export function getCreditedDailyMinutes(record, shiftId = null) {
  return calcCreditedDailyMilliseconds(record, shiftId) / 60000;
}

export function getExpectedShiftMinutes(record, shiftId = null) {
  const shift = shiftId || inferShiftForRecord(record);
  if (!shift || !record?.data) return null;
  const weekday = new Date(`${record.data}T12:00:00`).getDay() || 7;
  const daily = makeEmployeeSchedule(shift)?.horarios_por_dia?.[String(weekday)];
  if (!daily?.entrada || !daily?.saida) return null;
  const expectedExitDate = clockMinutes(daily.saida) <= clockMinutes(daily.entrada)
    ? nextIsoDate(record.data)
    : record.data;
  return getCreditedDailyMinutes({
    data: record.data,
    entrada: daily.entrada,
    saida: daily.saida,
    saida_data: expectedExitDate,
    turno_trabalhado: shift,
  }, shift);
}

export function getOvertimeMinutes(record, shiftId = null) {
  if (!record?.entrada || !record?.saida) return 0;
  const shift = shiftId || inferShiftForRecord(record);
  const expected = getExpectedShiftMinutes(record, shift);
  if (expected == null) return 0;
  return Math.max(0, getCreditedDailyMinutes(record, shift) - expected);
}

export function formatMinutesAsHours(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return '—';
  const roundedMinutes = Math.round(Math.abs(totalMinutes));
  let hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

/**
 * Calcula o total trabalhado no dia (entrada-almoço + retorno-saída)
 */
export function calcDailyTotal(record) {
  const totalMs = calcCreditedDailyMilliseconds(record);
  return totalMs === 0 ? '—' : formatMinutesAsHours(totalMs / 60000);
}

function clockMinutes(value) {
  if (!value) return null;
  const [hours, minutes, seconds = '0'] = String(value).split(':');
  const parsed = [Number(hours), Number(minutes), Number(seconds)];
  return parsed.every(Number.isFinite) ? parsed[0] * 60 + parsed[1] + parsed[2] / 60 : null;
}

function dateDayNumber(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

function elapsedClockMinutes(startDate, startTime, endDate, endTime) {
  const startMinute = clockMinutes(startTime);
  const endMinute = clockMinutes(endTime);
  const startDay = dateDayNumber(startDate);
  const endDay = dateDayNumber(endDate || startDate);
  if ([startMinute, endMinute, startDay, endDay].some((value) => value == null)) return 0;
  return Math.max(0, (endDay - startDay) * 1440 + endMinute - startMinute);
}

// Horas corridas efetivamente registradas, sem conversão de adicional noturno CLT.
export function getElapsedWorkMinutes(record) {
  if (!record?.entrada || !record?.saida) return 0;
  const endDate = record.saida_data || record.data;
  let minutes = elapsedClockMinutes(record.data, record.entrada, endDate, record.saida);
  if (record.saida_almoco && record.retorno_almoco) {
    const { lunchDate, returnDate } = getRecordedLunchDates(record);
    minutes -= elapsedClockMinutes(lunchDate, record.saida_almoco, returnDate, record.retorno_almoco);
  }
  return Math.max(0, minutes);
}

export function calcElapsedDailyTotal(record) {
  if (!record?.entrada || !record?.saida) return '—';
  return formatMinutesAsHours(getElapsedWorkMinutes(record));
}

/**
 * Valida um CPF
 */
export function validateCPF(cpf) {
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cleaned)) return false;
  
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned.charAt(i)) * (10 - i);
  }
  let remainder = 11 - (sum % 11);
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned.charAt(9))) return false;
  
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned.charAt(i)) * (11 - i);
  }
  remainder = 11 - (sum % 11);
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned.charAt(10))) return false;
  
  return true;
}

/**
 * Formata CPF para exibição: 000.000.000-00
 */
export function formatCPF(cpf) {
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length !== 11) return cpf;
  return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * Máscara de CPF durante digitação
 */
export function maskCPF(value) {
  return value
    .replace(/\D/g, '')
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
