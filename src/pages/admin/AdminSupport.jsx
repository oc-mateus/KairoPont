import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { supportEnabled, supportRequest } from '../../lib/support';
import { getSupportReplyUrl, SUPPORT_STATUS } from '../../../shared/support.mjs';
import useSupportTickets from '../../hooks/useSupportTickets';
import SupportTickets from '../../components/support/SupportTickets';

export default function AdminSupport() {
  const { profile } = useAuth();
  const [status, setStatus] = useState('aberto');
  const [selected, setSelected] = useState(null);
  const [response, setResponse] = useState('');
  const [nextStatus, setNextStatus] = useState('respondido');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const state = useSupportTickets({ enabled: supportEnabled, employeeId: profile?.id, admin: true, status });
  const replyUrl = getSupportReplyUrl(selected);
  useEffect(() => { setSelected(null); setResponse(''); setNotice(''); setError(''); }, [status]);

  function select(ticket) { setSelected(ticket); setResponse(ticket.response || ''); setNextStatus('respondido'); setError(''); setNotice(''); }
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const { data, error: updateError } = await supabase.rpc('admin_respond_support_ticket', { p_ticket_id: selected.id, p_response: response.trim(), p_status: nextStatus });
      const ticket = Array.isArray(data) ? data[0] : data;
      if (updateError || !ticket?.id) throw new Error('Não foi possível salvar o atendimento. Atualize a lista e tente novamente.');
      setSelected(null); setResponse(''); setNotice('Atendimento atualizado. A resposta está disponível para o solicitante no portal.'); state.refresh();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  async function retryEmail() {
    if (saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await supportRequest({ action: 'notify_ticket', ticket_id: selected.id });
      setNotice(result.delivery === 'sent' ? 'Aviso enviado ao e-mail de suporte.' : result.delivery === 'not_configured' ? 'O canal de e-mail ainda não foi configurado. O chamado continua disponível na fila.' : 'O aviso não foi reenviado: ele pode já ter sido enviado, estar em processamento ou precisar de revisão. O chamado continua disponível na fila.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return <div className="admin-support"><div className="page-header"><h1 className="page-title">Atendimentos</h1><p className="page-subtitle">Analise os chamados e responda com o contexto da equipe.</p></div>
    {!supportEnabled ? <p role="status" className="support-empty">O atendimento está em preparação. A fila será habilitada na publicação do suporte.</p> : <>
      <div className="support-section-header"><label htmlFor="support-status-filter" className="form-group"><span className="form-label">Mostrar chamados</span><select id="support-status-filter" className="form-input" value={status} disabled={saving} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos</option>{Object.entries(SUPPORT_STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button className="btn btn-secondary" onClick={state.refresh} disabled={state.loading || saving}>Atualizar lista</button></div>
      {error && <p role="alert" className="support-error">{error}</p>}{notice && <p role="status" className="support-confirmation">{notice}</p>}
      <div className="support-admin-columns"><section aria-label="Fila de chamados"><SupportTickets state={state} selectedId={selected?.id} onSelect={saving ? undefined : select} /></section>
        <section className="support-admin-detail" aria-label="Detalhes do atendimento">{selected ? <><div className="support-ticket-meta"><span>Chamado #{selected.protocol}</span><span>{SUPPORT_STATUS[selected.status]}</span></div><h2>{selected.subject}</h2>
          <div className="support-requester">
            <dl><div><dt>Solicitante</dt><dd>{selected.employee?.nome || 'Nome não informado'}</dd></div><div><dt>E-mail</dt><dd>{selected.employee?.email || 'E-mail não informado no cadastro'}</dd></div></dl>
            {replyUrl && <><a className="btn btn-secondary" href={replyUrl}>Responder por e-mail</a><p className="text-muted">Abre seu aplicativo de e-mail com o destinatário e o protocolo preenchidos.</p></>}
          </div>
          <p className="support-preserve-text">{selected.description}</p><form onSubmit={save} aria-busy={saving}>
          <label className="form-group" htmlFor="support-admin-reply"><span className="form-label">Resposta visível para o solicitante</span><textarea id="support-admin-reply" className="form-input" rows={6} value={response} maxLength={4000} minLength={nextStatus === 'respondido' ? 5 : undefined} required={nextStatus === 'respondido'} disabled={saving} onChange={(event) => setResponse(event.target.value)} /></label>
          <label className="form-group" htmlFor="support-admin-status"><span className="form-label">Status após salvar</span><select id="support-admin-status" className="form-input" value={nextStatus} disabled={saving} onChange={(event) => setNextStatus(event.target.value)}>{['em_atendimento','respondido','encerrado'].map((id) => <option key={id} value={id}>{SUPPORT_STATUS[id]}</option>)}</select></label>
          <div className="support-admin-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar atendimento'}</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={retryEmail}>Reenviar aviso à equipe</button></div>
        </form></> : <p className="text-muted">Selecione um chamado para ler os detalhes e responder.</p>}</section>
      </div>
    </>}
  </div>;
}
