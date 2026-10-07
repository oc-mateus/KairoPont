import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

function addIsoDays(dateValue, days) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function SaleChoiceFields({ choice, onChoiceChange, days, onDaysChange, disabled = false }) {
  return <fieldset className="vacation-choice-group" disabled={disabled}>
    <legend>Venda de até 10 dias (abono)</legend>
    <label className="vacation-choice-option"><input type="checkbox" checked={choice === 'yes'} onChange={() => onChoiceChange('yes')} />Sim, pretendo vender parte das férias</label>
    <label className="vacation-choice-option"><input type="checkbox" checked={choice === 'no'} onChange={() => onChoiceChange('no')} />Não pretendo vender férias</label>
    {choice === 'yes' && <label className="form-group">Quantidade de dias para venda<select className="form-input" value={days} onChange={(event) => onDaysChange(event.target.value)}>{Array.from({ length: 10 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day} {day === 1 ? 'dia' : 'dias'}</option>)}</select></label>}
  </fieldset>;
}

export default function VacationsPage() {
  const { profile, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const employeeFilter = searchParams.get('funcionario');
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState([]);
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [daysByPeriod, setDaysByPeriod] = useState({});
  const [saleChoiceByPeriod, setSaleChoiceByPeriod] = useState({});
  const [datesByPeriod, setDatesByPeriod] = useState({});
  const [reasons, setReasons] = useState({});
  const [busyId, setBusyId] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { error: syncError } = await supabase.rpc('sync_current_vacation_periods');
      if (syncError) throw syncError;
      let periodQuery = supabase.from('periodos_aquisitivos_ferias').select('*').order('periodo_inicio', { ascending: false });
      let requestQuery = supabase.from('solicitacoes_ferias').select('*').order('created_at', { ascending: false });
      if (isAdmin && employeeFilter) {
        periodQuery = periodQuery.eq('funcionario_id', employeeFilter);
        requestQuery = requestQuery.eq('funcionario_id', employeeFilter);
      }
      const [periodResult, requestResult, notificationResult] = await Promise.all([
        periodQuery,
        requestQuery,
        isAdmin || !profile?.id ? Promise.resolve({ data: [], error: null }) : supabase.from('notificacoes').select('*').eq('funcionario_id', profile.id).order('created_at', { ascending: false }),
      ]);
      if (periodResult.error) throw periodResult.error;
      if (requestResult.error) throw requestResult.error;
      if (notificationResult.error) throw notificationResult.error;
      setPeriods(periodResult.data || []);
      setRequests(requestResult.data || []);
      setNotifications(notificationResult.data || []);
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
  }, [employeeFilter, isAdmin, profile?.id, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const requestsByPeriod = useMemo(() => Object.groupBy ? Object.groupBy(requests, (request) => request.periodo_id) : requests.reduce((grouped, request) => ({ ...grouped, [request.periodo_id]: [...(grouped[request.periodo_id] || []), request] }), {}), [requests]);
  const pendingRequests = requests.filter((request) => request.status === 'pendente');
  const setPeriodValue = (setter, id, key, value) => setter((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  const submitSaleIntention = async (period) => {
    const choice = saleChoiceByPeriod[period.id] || (Number(period.dias_abono) > 0 ? 'yes' : 'no');
    const days = choice === 'yes' ? Number(daysByPeriod[period.id] ?? period.dias_abono ?? 1) : 0;
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
    if (!dates.departure || !dates.returnDate) return toast.warning('Informe a data de saída e a data de retorno ao trabalho.');
    if (dates.returnDate <= dates.departure) return toast.warning('A data de retorno deve ser posterior à data de saída.');
    setBusyId(period.id);
    try {
      const { error } = await supabase.rpc('submit_vacation_request_with_return', { p_periodo_id: period.id, p_data_saida: dates.departure, p_data_retorno: dates.returnDate });
      if (error) throw error;
      toast.success('Solicitação enviada à equipe administrativa. A decisão será enviada somente por e-mail.');
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

  const markNotificationRead = async (notification) => {
    const { error } = await supabase.from('notificacoes').update({ lida_em: new Date().toISOString() }).eq('id', notification.id);
    if (error) return toast.error('Não foi possível marcar o aviso como lido.');
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, lida_em: new Date().toISOString() } : item));
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

    {!isAdmin && notifications.filter((notification) => !notification.lida_em).map((notification) => <div className={`alert ${notification.tipo === 'ferias_vencidas' ? 'alert-danger' : 'alert-warning'}`} key={notification.id}><strong>{notification.titulo}</strong><p>{notification.mensagem}</p><button className="btn btn-ghost btn-sm" onClick={() => markNotificationRead(notification)}>Marcar como lido</button></div>)}

    {!isAdmin && periods.map((period) => {
      const existing = requestsByPeriod[period.id] || [];
      const requested = existing.find((request) => ['pendente', 'aprovada'].includes(request.status));
      const pending = existing.filter((request) => request.status === 'pendente');
      const today = getTodayInSP();
      const saleOpen = today <= addIsoDays(period.periodo_fim, -15);
      const eligible = today > period.periodo_fim && today <= period.prazo_concessivo;
      const requestDates = datesByPeriod[period.id] || {};
      const savedSaleChoice = Number(period.dias_abono) > 0 ? 'yes' : 'no';
      const editableSaleChoice = saleChoiceByPeriod[period.id] || savedSaleChoice;
      const requestSaleDays = Number(period.dias_abono) || 0;
      const earliestRequestDate = addIsoDays(period.periodo_fim, 1);
      const earliestLeaveDate = addIsoDays(earliestRequestDate, 30);
      return <section className="vacation-cycle-card" key={period.id}>
        <div className="vacation-cycle-heading"><div><h3>Período aquisitivo {dateLabel(period.periodo_inicio)} – {dateLabel(period.periodo_fim)}</h3><p>Prazo para concessão até {dateLabel(period.prazo_concessivo)}</p></div><Badge variant={period.prazo_concessivo < today ? 'danger' : eligible ? 'success' : 'info'}>{period.prazo_concessivo < today ? 'Prazo vencido' : eligible ? 'Direito adquirido' : 'Em aquisição'}</Badge></div>
        <div className="vacation-cycle-summary vacation-eligibility-details"><span>Data de admissão: <strong>{dateLabel(profile?.data_admissao)}</strong></span><span>Direito adquirido: <strong>{period.dias_direito} dias</strong></span><span>Abono de férias: <strong>{requestSaleDays ? `${requestSaleDays} dia(s) vendido(s)` : 'Não solicitado'}</strong></span><span>Prazo para gozo até: <strong>{dateLabel(period.prazo_concessivo)}</strong></span></div>
        {!eligible && today <= period.periodo_fim && <div className="vacation-ineligible-message"><strong>Funcionário ainda não elegível para gozo de férias.</strong><span>Você poderá solicitar a partir de {dateLabel(earliestRequestDate)}, após completar um ano de empresa. Se o pedido for enviado nessa data, a saída mais cedo permitida será {dateLabel(earliestLeaveDate)} (antecedência mínima de 30 dias).</span></div>}
        {saleOpen && <div className="vacation-inline-form"><SaleChoiceFields choice={editableSaleChoice} onChoiceChange={(choice) => setSaleChoiceByPeriod((current) => ({ ...current, [period.id]: choice }))} days={daysByPeriod[period.id] ?? (Number(period.dias_abono) || 1)} onDaysChange={(days) => setDaysByPeriod((current) => ({ ...current, [period.id]: days }))} /><button className="btn btn-secondary" disabled={busyId === period.id} onClick={() => submitSaleIntention(period)}>Salvar opção de venda</button><small>Defina se pretende vender até 10 dias e a quantidade até {dateLabel(addIsoDays(period.periodo_fim, -15))}. Essa opção precisa ser registrada antes do prazo; o pedido de gozo abre após completar um ano.</small></div>}
        {eligible && !requested && <div className="vacation-inline-form"><p>Informe o dia em que sairá e o dia em que voltará ao trabalho. A duração do afastamento deve corresponder a {period.dias_direito - requestSaleDays} dia(s), considerando a opção de abono registrada no prazo.</p><div className="form-row"><label className="form-group">Data de saída<input className="form-input" type="date" min={addIsoDays(today, 30)} max={period.prazo_concessivo} value={requestDates.departure || ''} onChange={(event) => setPeriodValue(setDatesByPeriod, period.id, 'departure', event.target.value)} /></label><label className="form-group">Data de retorno ao trabalho<input className="form-input" type="date" min={requestDates.departure ? addIsoDays(requestDates.departure, 1) : addIsoDays(today, 31)} max={addIsoDays(period.prazo_concessivo, 1)} value={requestDates.returnDate || ''} onChange={(event) => setPeriodValue(setDatesByPeriod, period.id, 'returnDate', event.target.value)} /></label></div><SaleChoiceFields choice={savedSaleChoice} onChoiceChange={() => {}} days={requestSaleDays || 1} onDaysChange={() => {}} disabled={!saleOpen} /><small className="vacation-form-note">{period.abono_solicitado_em ? `Opção de abono registrada em ${dateLabel(period.abono_solicitado_em.slice(0, 10))}; a quantidade acima é a definida no prazo legal.` : 'Nenhuma intenção de venda foi registrada no prazo legal; este pedido seguirá sem abono.'} O pedido será enviado aos administradores para análise.</small><button className="btn btn-primary" disabled={busyId === period.id} onClick={() => submitRequest(period)}>Enviar solicitação aos administradores</button></div>}
        {pending.length > 0 && <div className="vacation-request-history">{pending.map((request) => <article className="vacation-request-row" key={request.id}><div><strong>Saída: {dateLabel(request.data_inicio)} · Retorno: {dateLabel(request.data_retorno || addIsoDays(request.data_fim, 1))}</strong><small>Solicitado em {dateLabel(request.created_at?.slice(0, 10))}</small></div><Badge variant="warning">Aguardando decisão</Badge></article>)}</div>}
        {existing.some((request) => request.status !== 'pendente') && <p className="vacation-email-only-note">A devolutiva das decisões é enviada exclusivamente ao seu e-mail corporativo.</p>}
      </section>;
    })}

    {!isAdmin && periods.length === 0 && profile?.data_admissao && <div className="empty-state"><h3 className="empty-state-title">Ainda não há período aquisitivo disponível.</h3></div>}

    {isAdmin && <section className="vacation-admin-queue"><h3>Solicitações pendentes</h3>{pendingRequests.length === 0 && <p className="employee-no-results">Nenhuma solicitação aguardando decisão.</p>}{pendingRequests.map((request) => { const employee = employees[request.funcionario_id]; return <article className="vacation-admin-request" key={request.id}><div className="vacation-cycle-heading"><div><h4>{employee?.nome || 'Funcionário'} · {employee?.cargo || 'Cargo não informado'}</h4><p>{employee?.email}</p></div><Badge variant="warning">Pendente</Badge></div><p>Saída: <strong>{dateLabel(request.data_inicio)}</strong> · Retorno ao trabalho: <strong>{dateLabel(request.data_retorno || addIsoDays(request.data_fim, 1))}</strong></p><label className="form-group">Justificativa (obrigatória para recusa)<textarea className="form-input" rows="3" value={reasons[request.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Explique o motivo caso a solicitação seja recusada" /></label><div className="vacation-admin-actions"><button className="btn btn-primary" disabled={busyId === request.id} onClick={() => decide(request, true)}>Aprovar e enviar e-mail</button><button className="btn btn-secondary" disabled={busyId === request.id} onClick={() => decide(request, false)}>Recusar e enviar e-mail</button></div></article>; })}
      <h3 className="vacation-history-title">Histórico de decisões</h3>{requests.filter((request) => request.status !== 'pendente').map((request) => <article className="vacation-request-row" key={request.id}><div><strong>{employees[request.funcionario_id]?.nome || 'Funcionário'} · Saída: {dateLabel(request.data_inicio)} · Retorno: {dateLabel(request.data_retorno || addIsoDays(request.data_fim, 1))}</strong><small>{statusLabel(request.status)} · {request.email_enviado_em ? `E-mail enviado ${dateLabel(request.email_enviado_em.slice(0, 10))}` : request.email_erro ? `Erro no e-mail: ${request.email_erro}` : 'E-mail pendente'}</small>{request.status === 'recusada' && <small>Motivo: {request.justificativa_recusa}</small>}</div>{!request.email_enviado_em && <button className="btn btn-secondary btn-sm" disabled={busyId === request.id} onClick={() => sendDecisionEmail(request)}>Reenviar e-mail</button>}</article>)}</section>}

    {isAdmin && periods.length === 0 && <div className="alert alert-info">Preencha a data de admissão e a escala de trabalho de cada funcionário na tela Funcionários para iniciar o controle de férias.</div>}
  </div>;
}
