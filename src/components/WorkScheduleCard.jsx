import { getAssignedShiftId, getShiftLabel, makeEmployeeSchedule } from '../lib/workShifts';

const WEEKDAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];

export function WorkScheduleSummary({ schedule }) {
  if (!schedule) return <p className="work-schedule-empty">Escala ainda não informada pelo administrador.</p>;
  const shiftId = getAssignedShiftId(schedule);
  const visibleSchedule = shiftId ? makeEmployeeSchedule(shiftId) : schedule;
  const days = new Set(visibleSchedule.dias_semana || []);
  return <>
    <div className="work-schedule-days" aria-label="Dias de trabalho">{WEEKDAYS.map((day, index) => <span className={days.has(index + 1) ? 'scheduled' : ''} key={day}>{day}</span>)}</div>
    <div className="work-schedule-table">
      <div className="work-schedule-row work-schedule-header"><span>Dia</span><span>Entrada</span><span>Intervalo</span><span>Retorno</span><span>Saída</span></div>
      {WEEKDAYS.map((day, index) => {
        const weekday = index + 1;
        const works = days.has(weekday);
        const hours = visibleSchedule.horarios_por_dia?.[String(weekday)] || visibleSchedule;
        const hasLunch = hours.saida_almoco && hours.retorno_almoco;
        return <div className={`work-schedule-row ${works ? 'scheduled' : 'day-off'}`} key={day}>
          <strong>{day}</strong><span>{works ? hours.entrada || '—' : 'Folga'}</span><span>{works ? hasLunch ? hours.saida_almoco : 'Sem intervalo' : '—'}</span><span>{works && hasLunch ? hours.retorno_almoco : '—'}</span><span>{works ? hours.saida || '—' : '—'}{works && shiftId === 'turno3' && weekday <= 5 ? ' (dia seguinte)' : ''}</span>
        </div>;
      })}
    </div>
  </>;
}

export default function WorkScheduleCard({ schedule, admissionDate, compact = false }) {
  return <section className={`work-schedule-card ${compact ? 'compact' : ''}`}>
    <div className="work-schedule-heading">
      <div><h3>Turno habitual</h3><p>{getAssignedShiftId(schedule) ? getShiftLabel(getAssignedShiftId(schedule)) : 'Turno ainda não informado'}</p></div>
      {admissionDate && <span className="work-schedule-admission">Admissão: {new Date(`${admissionDate}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
    </div>
    <WorkScheduleSummary schedule={schedule} />
  </section>;
}
