import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Badge, Spinner } from '../components/ui';
import { formatDate, getTodayInSP } from '../lib/utils';

function dateLabel(value) {
  return value ? formatDate(`${value}T12:00:00`) : '—';
}

function statusLabel(status) {
  return ({ pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada' })[status] || status;
}

export default function VacationsPage() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState([]);
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState({});
  const [daysByPeriod, setDaysByPeriod] = useState({});
  const [datesByPeriod, setDatesByPeriod] = useState({});
  const [reasons, setReasons] = useState({});
  const [busyId, setBusyId] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { error: syncError } = await supabase.rpc('sync_current_vacation_periods');
      if (syncError) throw syncError;
      const [periodResult, requestResult] = await Promise.all([
        supabase.from('periodos_aquisitivos_ferias').select('*').order('periodo_inicio', { ascending: false }),
        supabase.from('solicitacoes_ferias').select('*').order('created_at', { ascending: false }),
      ]);
      if (periodResult.error) throw periodResult.error;
      if (requestResult.error) throw requestResult.error;
      setPeriods(periodResult.data || []);
      setRequests(requestResult.data || []);
      if (isAdmin) {
        const { data, error } = await supabase.from('funcionarios').select('id,nome,email,cargo').order('nome');
        if (error) throw error;
        setEmployees(Object.fromEntries((data || []).map((employee) => [employee.id, employee])));
      }
    } catch (error) {
      toast.error(`Não foi possível carregar as férias: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const requestsByPeriod = useMemo(() => Object.groupBy ? Object.groupBy(requests, (request) => request.periodo_id) : requests.reduce((grouped, request) => ({ ...grouped, [request.periodo_id]: [...(grouped[request.periodo_id] || []), request] }), {}), [requests]);
  const pendingRequests = requests.filter((request) => request.status === 'pendente');
  const setPeriodValue = (setter, id, key, value) => setter((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  const submitSaleIntention = async (period) => {
    const days = Number(daysByPeriod[period.id] ?? period.dias_abono ?? 0);
    setBusyId(period.id);
    try {
      const { error } = await supabase.rpc('set_vacation_sale_intention', { p_periodo_id: period.id, p_dias_abono: days });
      if (error) throw error;
      toast.success('Intenção de abono registrada dentro do prazo.');
      await loadData();
    } catch (error) {
      toast.error(error.message || 'Não foi possível registrar a intenção de abono.');
    } finally { setBusyId(''); }
  };

  const submitRequest = async (period) => {
    const dates = datesByPeriod[period.id] || {};
    if (!dates.start || !dates.end) return toast.warning('Informe as datas desejadas para as férias.');
    setBusyId(period.id);
    try {
      const { error } = await supabase.rpc('submit_vacation_request', { p_periodo_id: period.id, p_data_inicio: dates.start, p_data_fim: dates.end });
      if (error) throw error;
      toast.success('Solicitação enviada ao administrador. O resultado será enviado somente por e-mail.');
      await loadData();
    } catch (error) {
      toast.error(error.message || 'Não foi possível solicitar as férias.');
    } finally { setBusyId(''); }
  };

  const sendDecisionEmail = async (request) => {
    setBusyId(request.id);
    try {
      const { data, error } = await supabase.functions.invoke('vacation-decision-email', { body: { solicitacao_id: request.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('E-mail da decisão enviado ao funcionário.');
      await loadData();
    } catch (error) {
      toast.error(error.message || 'Decisão registrada, mas o e-mail não foi enviado. Verifique a configuração de e-mail.');
    } finally { setBusyId(''); }
  };

  const decide = async (request, approved) => {
    const reason = (reasons[request.id] || '').trim();
    if (!approved && reason.length < 5) return toast.warning('Informe uma justificativa de pelo menos 5 caracteres.');
    setBusyId(request.id);
    try {
      const { error } = await supabase.rpc('decide_vacation_request', {
        p_solicitacao_id: request.id, p_aprovar: approved, p_justificativa: approved ? null : reason,
      });
      if (error) throw error;
      toast.success(`Solicitação ${approved ? 'aprovada' : 'recusada'}; enviando o e-mail ao funcionário…`);
      await loadData();
      await sendDecisionEmail(request);
    } catch (error) {
      toast.error(error.message || 'Não foi possível registrar a decisão.');
      setBusyId('');
    }
  };

  if (loading) return <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>;

  return <div className="vacations-page">
    <div className="page-header"><div><h2 className="page-title">{isAdmin ? 'Férias dos funcionários' : 'Minhas férias'}</h2><p className="page-subtitle">Períodos aquisitivos, solicitação de gozo e acompanhamento de prazos.</p></div><button className="btn btn-secondary btn-sm" onClick={loadData}>Atualizar</button></div>

    {!isAdmin && !profile?.data_admissao && <div className="alert alert-warning">Sua data de admissão ainda não foi informada. Peça ao administrador para completar seu cadastro trabalhista.</div>}

    {!isAdmin && periods.map((period) => {
      const existing = requestsByPeriod[period.id] || [];
      const requested = existing.find((request) => ['pendente', 'aprovada'].includes(request.status));
      const today = getTodayInSP();
      const saleOpen = today <= new Date(new Date(`${period.periodo_fim}T12:00:00`).getTime() - 15 * 86400000).toISOString().slice(0, 10);
      const eligible = today > period.periodo_fim && today <= period.prazo_concessivo;
      const requestDates = datesByPeriod[period.id] || {};
      return <section className="vacation-cycle-card" key={period.id}>
        <div className="vacation-cycle-heading"><div><h3>Período aquisitivo {dateLabel(period.periodo_inicio)} – {dateLabel(period.periodo_fim)}</h3><p>Prazo para concessão até {dateLabel(period.prazo_concessivo)}</p></div><Badge variant={period.prazo_concessivo < today ? 'danger' : eligible ? 'success' : 'info'}>{period.prazo_concessivo < today ? 'Prazo vencido' : eligible ? 'Direito adquirido' : 'Em aquisição'}</Badge></div>
        <p className="vacation-cycle-summary">Direito: {period.dias_direito} dias · Abono registrado: {period.dias_abono} dia(s)</p>
        {saleOpen && <div className="vacation-inline-form"><label className="form-group">Pretende converter dias em abono? (0 a 10)<select className="form-input" value={daysByPeriod[period.id] ?? period.dias_abono} onChange={(event) => setDaysByPeriod((current) => ({ ...current, [period.id]: event.target.value }))}>{Array.from({ length: 11 }, (_, day) => <option key={day} value={day}>{day} {day === 1 ? 'dia' : 'dias'}</option>)}</select></label><button className="btn btn-secondary" disabled={busyId === period.id} onClick={() => submitSaleIntention(period)}>Registrar intenção de abono</button><small>Disponível até 15 dias antes do fim do período aquisitivo. O pedido de gozo só abre após completar 1 ano.</small></div>}
        {eligible && !requested && <div className="vacation-inline-form"><p>Informe o período desejado. A duração deve corresponder aos dias de direito, descontado eventual abono.</p><div className="form-row"><label className="form-group">Início<input className="form-input" type="date" min={today} value={requestDates.start || ''} onChange={(event) => setPeriodValue(setDatesByPeriod, period.id, 'start', event.target.value)} /></label><label className="form-group">Fim<input className="form-input" type="date" min={requestDates.start || today} value={requestDates.end || ''} onChange={(event) => setPeriodValue(setDatesByPeriod, period.id, 'end', event.target.value)} /></label></div><button className="btn btn-primary" disabled={busyId === period.id} onClick={() => submitRequest(period)}>Solicitar férias</button></div>}
        {existing.length > 0 && <div className="vacation-request-history">{existing.map((request) => <article className="vacation-request-row" key={request.id}><div><strong>{dateLabel(request.data_inicio)} – {dateLabel(request.data_fim)}</strong><small>Solicitado em {dateLabel(request.created_at?.slice(0, 10))}</small>{request.status === 'recusada' && <p>Justificativa registrada: {request.justificativa_recusa}</p>}</div><Badge variant={request.status === 'aprovada' ? 'success' : request.status === 'recusada' ? 'danger' : 'warning'}>{statusLabel(request.status)}</Badge></article>)}</div>}
      </section>;
    })}

    {!isAdmin && periods.length === 0 && profile?.data_admissao && <div className="empty-state"><h3 className="empty-state-title">Ainda não há período aquisitivo disponível.</h3></div>}

    {isAdmin && <section className="vacation-admin-queue"><h3>Solicitações pendentes</h3>{pendingRequests.length === 0 && <p className="employee-no-results">Nenhuma solicitação aguardando decisão.</p>}{pendingRequests.map((request) => { const employee = employees[request.funcionario_id]; return <article className="vacation-admin-request" key={request.id}><div className="vacation-cycle-heading"><div><h4>{employee?.nome || 'Funcionário'} · {employee?.cargo || 'Cargo não informado'}</h4><p>{employee?.email}</p></div><Badge variant="warning">Pendente</Badge></div><p>Período solicitado: <strong>{dateLabel(request.data_inicio)} – {dateLabel(request.data_fim)}</strong></p><label className="form-group">Justificativa (obrigatória para recusa)<textarea className="form-input" rows="3" value={reasons[request.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Explique o motivo caso a solicitação seja recusada" /></label><div className="vacation-admin-actions"><button className="btn btn-primary" disabled={busyId === request.id} onClick={() => decide(request, true)}>Aprovar e enviar e-mail</button><button className="btn btn-secondary" disabled={busyId === request.id} onClick={() => decide(request, false)}>Recusar e enviar e-mail</button></div></article>; })}
      <h3 className="vacation-history-title">Histórico de decisões</h3>{requests.filter((request) => request.status !== 'pendente').map((request) => <article className="vacation-request-row" key={request.id}><div><strong>{employees[request.funcionario_id]?.nome || 'Funcionário'} · {dateLabel(request.data_inicio)} – {dateLabel(request.data_fim)}</strong><small>{statusLabel(request.status)} · {request.email_enviado_em ? `E-mail enviado ${dateLabel(request.email_enviado_em.slice(0, 10))}` : request.email_erro ? `Erro no e-mail: ${request.email_erro}` : 'E-mail pendente'}</small>{request.status === 'recusada' && <small>Motivo: {request.justificativa_recusa}</small>}</div>{!request.email_enviado_em && <button className="btn btn-secondary btn-sm" disabled={busyId === request.id} onClick={() => sendDecisionEmail(request)}>Reenviar e-mail</button>}</article>)}</section>}

    {isAdmin && periods.length === 0 && <div className="alert alert-info">Preencha a data de admissão e a escala de trabalho de cada funcionário na tela Funcionários para iniciar o controle de férias.</div>}
  </div>;
}
