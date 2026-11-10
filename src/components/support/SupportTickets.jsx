import { SUPPORT_STATUS } from '../../../shared/support.mjs';

export default function SupportTickets({ state, onSelect, selectedId }) {
  return <>
    {state.loading && <p role="status" className="text-muted">Carregando chamados…</p>}
    {state.error && <div role="alert"><p className="support-error">{state.error}</p><button className="btn btn-secondary" onClick={state.refresh}>Tentar novamente</button></div>}
    {!state.loading && !state.error && state.tickets.length === 0 && <p className="support-empty">Nenhum chamado por aqui. Quando você abrir um atendimento, ele aparecerá nesta lista.</p>}
    {!state.loading && state.tickets.map((ticket) => <article className={`support-ticket ${selectedId === ticket.id ? 'is-selected' : ''}`} key={ticket.id}>
      <div className="support-ticket-meta"><span>#{ticket.protocol} · {new Date(ticket.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span><span className={`support-status is-${ticket.status}`}>{SUPPORT_STATUS[ticket.status] || 'Em análise'}</span></div>
      {onSelect ? <button className="support-ticket-select" onClick={() => onSelect(ticket)} aria-pressed={selectedId === ticket.id}>{ticket.subject}</button> : <h3>{ticket.subject}</h3>}
      {ticket.employee?.nome && <p className="text-muted">{ticket.employee.nome}</p>}
      {ticket.employee?.email && <p className="support-requester-email">{ticket.employee.email}</p>}
      {!onSelect && <p className="support-preserve-text">{ticket.description}</p>}
    </article>)}
    {(state.page > 0 || state.hasMore) && <nav className="support-pagination" aria-label="Páginas de chamados">
      <button className="btn btn-secondary" disabled={state.page === 0 || state.loading} onClick={() => state.setPage((value) => value - 1)}>Anterior</button>
      <span>Página {state.page + 1}</span>
      <button className="btn btn-secondary" disabled={!state.hasMore || state.loading} onClick={() => state.setPage((value) => value + 1)}>Próxima</button>
    </nav>}
  </>;
}
