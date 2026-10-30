import { useEffect, useState } from 'react';
import { getHabitualSchedules, getRegisteredScheduleLabel } from '../lib/workShifts';

export function WorkScheduleSummary({ schedule }) {
  if (!schedule) return <p className="work-schedule-empty">Horário de trabalho ainda não informado pelo administrador.</p>;
  const habitualSchedules = getHabitualSchedules(schedule);
  if (!habitualSchedules.length) return <p className="work-schedule-empty">Horário de trabalho ainda não informado pelo administrador.</p>;
  return <div className="work-schedule-list" aria-label="Horários habituais">
    {habitualSchedules.map((item) => <article className="work-schedule-item" key={item.id || item.entrada}>
      <span className="work-schedule-time">{item.entrada}–{item.saida}</span>
      <span className="work-schedule-meal">{item.saida_almoco && item.retorno_almoco ? `Almoço ${item.saida_almoco}–${item.retorno_almoco}` : 'Sem intervalo fixo'}</span>
    </article>)}
    <p className="work-schedule-note">Aos sábados, a jornada prevista é de 4h, sem intervalo fixo.</p>
  </div>;
}

export default function WorkScheduleCard({ schedule, admissionDate, compact = false, preferenceKey = 'default' }) {
  const storageKey = `kairopont-work-schedule-${preferenceKey}`;
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'collapsed'; } catch { return true; }
  });

  useEffect(() => {
    try { setExpanded(localStorage.getItem(storageKey) !== 'collapsed'); } catch { setExpanded(true); }
  }, [storageKey]);

  const toggleExpanded = () => setExpanded((current) => {
    const next = !current;
    try { localStorage.setItem(storageKey, next ? 'expanded' : 'collapsed'); } catch { /* preferência local opcional */ }
    return next;
  });

  return <section className={`work-schedule-card ${compact ? 'compact' : ''} ${expanded ? '' : 'is-collapsed'}`}>
    <div className="work-schedule-heading">
      <div><h3>Horários habituais</h3><p>{getRegisteredScheduleLabel(schedule)}</p></div>
      <div className="work-schedule-heading-actions">
        {admissionDate && <span className="work-schedule-admission">Admissão: {new Date(`${admissionDate}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
        <button type="button" className="btn btn-secondary btn-sm" aria-expanded={expanded} onClick={toggleExpanded}>{expanded ? 'Recolher' : 'Expandir'}</button>
      </div>
    </div>
    {expanded && <WorkScheduleSummary schedule={schedule} />}
  </section>;
}
