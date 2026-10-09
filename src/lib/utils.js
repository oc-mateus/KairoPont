/**
 * Utilitários de data/hora para o fuso America/Sao_Paulo
 */

const TIMEZONE = 'America/Sao_Paulo';

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
  const date = new Date(isoString);
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
export function getCurrentWeekRange() {
  const today = new Date();
  const spDate = new Date(today.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const dayOfWeek = spDate.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  
  const monday = new Date(spDate);
  monday.setDate(spDate.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

/**
 * Retorna o início e fim do mês atual
 */
export function getCurrentMonthRange() {
  const today = new Date();
  const spDate = new Date(today.toLocaleString('en-US', { timeZone: TIMEZONE }));
  
  const firstDay = new Date(spDate.getFullYear(), spDate.getMonth(), 1);
  const lastDay = new Date(spDate.getFullYear(), spDate.getMonth() + 1, 0);
  
  return {
    start: firstDay.toISOString().split('T')[0],
    end: lastDay.toISOString().split('T')[0],
  };
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

export function formatMinutesAsHours(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return '—';
  const roundedMinutes = Math.round(Math.abs(totalMinutes));
  let hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (minutes === 59) hours += 1;
  if (minutes === 0 || minutes === 59) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

/**
 * Calcula o total trabalhado no dia (entrada-almoço + retorno-saída)
 */
export function calcDailyTotal(record) {
  if (!record) return '—';
  let totalMs = 0;

  const endDate = record.saida_data || record.data;
  if (record.entrada && record.saida && !record.saida_almoco && !record.retorno_almoco) {
    totalMs += calcNightAdjustedMilliseconds(record.data, record.entrada, endDate, record.saida);
  } else {
    if (record.entrada && record.saida_almoco) {
      totalMs += calcNightAdjustedMilliseconds(record.data, record.entrada, record.data, record.saida_almoco);
    }
    if (record.retorno_almoco && record.saida) {
      totalMs += calcNightAdjustedMilliseconds(record.data, record.retorno_almoco, endDate, record.saida);
    }
  }
  
  if (totalMs === 0) return '—';

  return formatMinutesAsHours(totalMs / 60000);
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
