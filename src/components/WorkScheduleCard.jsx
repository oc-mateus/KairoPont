const WEEKDAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];

export function WorkScheduleSummary({ schedule }) {
  if (!schedule) return <p className="work-schedule-empty">Escala ainda não informada pelo administrador.</p>;
  const days = new Set(schedule.dias_semana || []);
  return <>
    <div className="work-schedule-days" aria-label="Dias de trabalho">
      {WEEKDAYS.map((day, index) => <span className={days.has(index + 1) ? 'scheduled' : ''} key={day}>{day}</span>)}
    </div>
    <div className="work-schedule-times">
      <div><span>Entrada</span><strong>{schedule.entrada || '—'}</strong></div>
      <div><span>Saída para almoço</span><strong>{schedule.saida_almoco || '—'}</strong></div>
      <div><span>Retorno do almoço</span><strong>{schedule.retorno_almoco || '—'}</strong></div>
      <div><span>Saída final</span><strong>{schedule.saida || '—'}</strong></div>
    </div>
  </>;
}

export default function WorkScheduleCard({ schedule, admissionDate, compact = false }) {
  return <section className={`work-schedule-card ${compact ? 'compact' : ''}`}>
    <div className="work-schedule-heading">
      <div><h3>Escala de trabalho</h3><p>{schedule?.tipo ? `Escala ${schedule.tipo}` : 'Jornada semanal'}</p></div>
      {admissionDate && <span className="work-schedule-admission">Admissão: {new Date(`${admissionDate}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
    </div>
    <WorkScheduleSummary schedule={schedule} />
  </section>;
}
