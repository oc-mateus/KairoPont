import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import LoadError from '../components/LoadError';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { addIsoDays, formatTime, getTodayInSP } from '../lib/utils';
import { Spinner, Badge } from '../components/ui';
import { getAssignedShiftId, getFixedLunchLabel, getShiftLabel } from '../lib/workShifts';
import { capturePunchLocation, PUNCH_LOCATION_TIMEOUT_MS } from '../lib/punchLocation';
import {
  cachePunchRecords, projectPunchRecords, punchAccountKey, queuePunch, readPunchState,
  retryQueuedPunches, subscribeToPunchQueue, updateQueuedPunch,
} from '../lib/offlinePunches';
import { getIntershiftRestWarning } from '../lib/intershiftRest';
import PunchLocation from '../components/PunchLocation';

export const PunchInIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>;
export const LunchOutIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>;
export const LunchInIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 11 12 16 7"/><line x1="11" y1="12" x2="21" y2="12"/></svg>;
export const PunchOutIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
export const CompleteIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
export const BlockIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>;

const PUNCH_STEPS = [
  { field: 'entrada', label: 'Entrada', icon: PunchInIcon },
  { field: 'saida_almoco', label: 'Saída para almoço', icon: LunchOutIcon },
  { field: 'retorno_almoco', label: 'Retorno do almoço', icon: LunchInIcon },
  { field: 'saida', label: 'Saída', icon: PunchOutIcon },
];

function timestampForClock(date, clock, referenceClock) {
  const timestamp = Date.parse(`${date}T${clock}-03:00`);
  const reference = Date.parse(`${date}T${referenceClock}-03:00`);
  return timestamp < reference ? timestamp + 86400000 : timestamp;
}

export default function PunchPage() {
  const { profile: liveProfile, offlinePunchProfile, online } = useAuth();
  const profile = offlinePunchProfile ?? liveProfile;
  const account = punchAccountKey(profile);
  const toast = useToast();
  const [punchState, setPunchState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [remoteUnavailable, setRemoteUnavailable] = useState(false);
  const [punching, setPunching] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [cooldown, setCooldown] = useState(false);
  const punchInFlight = useRef(false);
  const latestFetch = useRef(0);
  const todayDate = getTodayInSP(currentTime);
  const offlineMode = !online || Boolean(offlinePunchProfile) || remoteUnavailable;

  // Atualiza relógio a cada segundo
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!account) return;
    let active = true;
    const refresh = () => readPunchState(account).then(
      (state) => { if (active) setPunchState(state); },
      () => { if (active) setLoadError(true); },
    );
    const unsubscribe = subscribeToPunchQueue(account, refresh);
    void refresh();
    return () => { active = false; unsubscribe(); };
  }, [account]);

  const fetchTodayRecord = useCallback(async () => {
    if (!account || todayDate !== getTodayInSP()) return;
    const request = ++latestFetch.current;
    setLoadError(false);
    try {
      const state = await readPunchState(account);
      if (request !== latestFetch.current) return;
      setPunchState(state);
      if (!online || offlinePunchProfile) return;

      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5000);
      try {
        const { data: records, error } = await supabase.from('registros_ponto')
          .select('*')
          .eq('funcionario_id', profile.id)
          .gte('data', addIsoDays(todayDate, -3))
          .lte('data', todayDate)
          .abortSignal(controller.signal);
        if (request !== latestFetch.current) return;
        if (error) throw error;
        await cachePunchRecords(account, records, state.revision);
        if (request === latestFetch.current) setRemoteUnavailable(false);
      } catch {
        if (request === latestFetch.current) setRemoteUnavailable(true);
      } finally {
        clearTimeout(deadline);
      }
    } catch {
      if (request === latestFetch.current) setLoadError(true);
    } finally {
      if (request === latestFetch.current) setLoading(false);
    }
  }, [account, profile?.id, todayDate, online, offlinePunchProfile]);

  useEffect(() => {
    fetchTodayRecord();
    return () => { latestFetch.current += 1; };
  }, [fetchTodayRecord]);

  useEffect(() => {
    if (!online || !remoteUnavailable) return;
    const timer = setInterval(fetchTodayRecord, 15000);
    return () => clearInterval(timer);
  }, [online, remoteUnavailable, fetchTodayRecord]);

  const state = punchState?.key === account ? punchState : null;
  const recentRecords = state ? projectPunchRecords(state, profile, todayDate) : [];
  const yesterday = addIsoDays(todayDate, -1);
  const todayRecord = recentRecords.find((record) => record.data === todayDate)
    ?? recentRecords.find((record) => record.data === yesterday && !record.saida
      && (profile?.tipo_contrato === 'pj' || record.turno_trabalhado === 'turno3'))
    ?? null;
  const pendingCount = state?.events.filter((event) => !event.serverSaved && !event.error).length ?? 0;
  const rejected = state?.events.filter((event) => event.error) ?? [];
  const assignedShiftId = getAssignedShiftId(profile?.escala_trabalho);
  const recordShiftId = todayRecord?.turno_trabalhado || assignedShiftId;
  const hasFixedLunch = todayRecord
    ? getFixedLunchLabel(recordShiftId, todayRecord.data) !== 'Sem intervalo'
    : false;
  const needsDynamicLunch = profile?.tipo_contrato !== 'pj' && Boolean(todayRecord) && !hasFixedLunch;
  const entryTimestamp = todayRecord?.entrada
    ? Date.parse(`${todayRecord.data}T${todayRecord.entrada}-03:00`)
    : null;
  const elapsedSinceEntryMinutes = entryTimestamp == null ? 0 : (currentTime.getTime() - entryTimestamp) / 60000;
  const breakStartTimestamp = todayRecord?.saida_almoco
    ? timestampForClock(todayRecord.data, todayRecord.saida_almoco, todayRecord.entrada)
    : null;
  const breakMinutes = breakStartTimestamp == null ? 0 : (currentTime.getTime() - breakStartTimestamp) / 60000;
  const waitingForLunchReturn = needsDynamicLunch && todayRecord?.saida_almoco && !todayRecord?.retorno_almoco && breakMinutes < 60;
  const canRegisterEarlyLunch = needsDynamicLunch && todayRecord && !todayRecord.saida
    && !todayRecord.saida_almoco && !todayRecord.retorno_almoco && elapsedSinceEntryMinutes > 0 && elapsedSinceEntryMinutes <= 360;

  const punchSteps = needsDynamicLunch && (todayRecord?.saida_almoco || elapsedSinceEntryMinutes > 360)
    ? PUNCH_STEPS
    : PUNCH_STEPS.filter((step) => step.field !== 'saida_almoco' && step.field !== 'retorno_almoco');

  // Determina o próximo passo, incluindo a pausa obrigatória em jornadas sem almoço fixo.
  const getNextStep = () => {
    if (!todayRecord) return 0; // entrada
    if (todayRecord.saida) return -1;
    if (needsDynamicLunch) {
      if (!todayRecord.saida_almoco && elapsedSinceEntryMinutes > 360) return punchSteps.findIndex((step) => step.field === 'saida_almoco');
      if (todayRecord.saida_almoco && !todayRecord.retorno_almoco) return punchSteps.findIndex((step) => step.field === 'retorno_almoco');
      if (todayRecord.saida_almoco && todayRecord.retorno_almoco) return punchSteps.findIndex((step) => step.field === 'saida');
      return punchSteps.findIndex((step) => step.field === 'saida');
    }
    return punchSteps.findIndex((step) => step.field === 'saida');
  };

  const nextStepIndex = getNextStep();
  const isComplete = Boolean(todayRecord?.saida);
  const intershiftRest = getIntershiftRestWarning(
    recentRecords, todayRecord?.data ?? todayDate, todayRecord?.entrada, currentTime,
  );
  const restUntil = intershiftRest && !todayRecord?.entrada
    ? intershiftRest.availableAt.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      ...(getTodayInSP(intershiftRest.availableAt) !== todayDate && { day: '2-digit', month: '2-digit' }),
    })
    : null;

  const handlePunch = async (fieldOverride = null) => {
    if (!account || !state || !profile.ativo || isComplete || punchInFlight.current || punching || cooldown || waitingForLunchReturn) return;
    punchInFlight.current = true;

    // Prevenção de clique duplo
    setCooldown(true);
    setTimeout(() => setCooldown(false), 3000);

    setPunching(true);
    try {
      // onClick handlers can pass the browser event as the first argument. Only
      // treat a known field name as an override; otherwise use the next step.
      const step = typeof fieldOverride === 'string'
        ? PUNCH_STEPS.find((item) => item.field === fieldOverride)
        : punchSteps[nextStepIndex];
      if (!step) throw new Error('Não foi possível identificar a próxima etapa do registro. Atualize a página e tente novamente.');
      const collectLocation = step.field === 'entrada' || step.field === 'saida';
      const id = crypto.randomUUID();
      const at = new Date();
      const saved = queuePunch(account, {
        id, field: step.field, at: at.toISOString(),
        recordId: step.field === 'entrada' ? id : todayRecord.id,
        offline: offlineMode || !navigator.onLine,
        locationDeadline: collectLocation ? at.getTime() + PUNCH_LOCATION_TIMEOUT_MS : null,
      }, profile);
      if (collectLocation) {
        const storeLocation = (location, locationDone) => {
          void saved.then(() => updateQueuedPunch(account, id, { location, locationDone })).catch(() => {});
        };
        void capturePunchLocation({
          onCandidate: (location) => storeLocation(location, false),
        }).then((location) => storeLocation(location, true), () => storeLocation({ status: 'unavailable' }, true));
      }
      await saved;
      toast.success(`${step.label} salva neste aparelho.`);
    } catch (err) {
      toast.error('Erro ao registrar ponto: ' + err.message);
    } finally {
      punchInFlight.current = false;
      setPunching(false);
    }
  };

  const displayTime = currentTime.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const displayDate = currentTime.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (loadError && !loading) {
    return <LoadError message="Não foi possível acessar os registros neste aparelho. Tente carregar a tela de ponto novamente." onRetry={fetchTodayRecord} />;
  }

  if (loading || !state) {
    return (
      <div className="flex flex-col flex-center" style={{ minHeight: '60vh' }}>
        <Spinner size="lg" />
        <p className="text-muted mt-4">Carregando registro do dia...</p>
      </div>
    );
  }

  return (
    <div className="punch-page">
      <div className="punch-page-heading">
        <div>
          <h2 className="page-title">Jornada de hoje</h2>
          <p className="page-subtitle">{displayDate}</p>
        </div>
        <div className="punch-clock" aria-label={`Horário atual: ${displayTime}`}>
          <span>Horário de Brasília</span>
          <strong>{displayTime}</strong>
        </div>
      </div>

      <div className="punch-employment-line">
        <Badge variant="info">Vínculo: {profile?.tipo_contrato === 'pj' ? 'PJ' : 'CLT'}</Badge>
        {profile?.tipo_contrato !== 'pj' && profile?.escala_trabalho && <Badge variant="neutral">Horário: {getShiftLabel(getAssignedShiftId(profile.escala_trabalho))}</Badge>}
      </div>

      <div className="punch-workspace">
      <section className="punch-action-panel">
        <h3>{isComplete ? 'Sua jornada foi concluída' : 'Sua próxima marcação'}</h3>
        {(offlineMode || pendingCount > 0) && (
          <div className="alert alert-info" role="status">
            <strong>{offlineMode ? 'Modo offline' : 'Sincronizando marcações'}</strong>
            <p>{pendingCount === 1 ? '1 marcação salva neste aparelho. ' : pendingCount > 1 ? `${pendingCount} marcações salvas neste aparelho. ` : ''}
              {offlineMode ? 'Os pontos serão enviados quando a conexão voltar e o app estiver aberto.' : 'Aguarde a confirmação do servidor.'}</p>
          </div>
        )}
        {rejected.length > 0 && (
          <div className="alert alert-warning" role="status">
            <strong>Marcações aguardando revisão</strong>
            <ul>{rejected.map((event) => (
              <li key={event.id}>{PUNCH_STEPS.find((step) => step.field === event.field)?.label} em {new Date(event.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. {event.error}</li>
            ))}</ul>
            <button type="button" className="btn btn-secondary btn-sm" disabled={offlineMode}
              onClick={() => retryQueuedPunches(account).catch(() => toast.error('Não foi possível tentar novamente.'))}>Tentar sincronizar</button>
          </div>
        )}
        {intershiftRest && (
          <div className="alert alert-warning" role="status">
            <strong>Descanso entre jornadas inferior a 11 horas</strong>
            <p>{restUntil
              ? `Aguarde até ${restUntil} (horário de Brasília) para completar as 11 horas de descanso.`
              : `Você teve ${intershiftRest.duration} de descanso entre a última saída e esta entrada. O mínimo é de 11 horas.`}
            </p>
          </div>
        )}
        {punching && <p className="punch-action-intro" role="status">Registrando ponto…</p>}
        {!isComplete && <p className="punch-policy-note">A entrada e a saída enviam a localização à administração quando ela está disponível.</p>}
        <button
          className="btn-punch"
          onClick={() => handlePunch()}
          disabled={isComplete || punching || cooldown || waitingForLunchReturn || !profile?.ativo}
        >
          {punching ? (
            <Spinner />
          ) : isComplete ? (
            <>
              <span className="punch-icon">{CompleteIcon}</span>
              <span className="punch-label">Dia Completo</span>
            </>
          ) : !profile?.ativo ? (
            <>
              <span className="punch-icon">{BlockIcon}</span>
              <span className="punch-label">Conta Inativa</span>
            </>
          ) : (
            <>
              <span className="punch-icon">{punchSteps[nextStepIndex].icon}</span>
              <span className="punch-label">{punchSteps[nextStepIndex].label}</span>
            </>
          )}
        </button>

        {canRegisterEarlyLunch && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handlePunch('saida_almoco')}
            disabled={punching || cooldown || !profile?.ativo}
          >
            Registrar saída para almoço
          </button>
        )}

        {needsDynamicLunch && (
          <p className="punch-policy-note">
            Acima de 6h de trabalho, registre uma pausa de 1h.
            {waitingForLunchReturn && ` O retorno poderá ser registrado em ${Math.ceil(60 - breakMinutes)} min.`}
          </p>
        )}

        {cooldown && !punching && !isComplete && (
          <p className="punch-cooldown-note">
            Aguarde para registrar novamente.
          </p>
        )}
      </section>

      <section className="card punch-record-card">
        <div className="card-header">
          <h3 className="card-title">Registros de Hoje</h3>
          <Badge variant={isComplete ? 'success' : todayRecord ? 'warning' : 'neutral'}>
            {isComplete ? 'Completo' : todayRecord ? 'Em andamento' : 'Não iniciado'}
          </Badge>
        </div>

        <div className="punch-timeline">
          {punchSteps.map((step, index) => {
            const value = todayRecord?.[step.field];
            const isCompleted = !!value;
            const isCurrent = index === nextStepIndex;
            const queued = state.events.find((event) => event.recordId === todayRecord?.id && event.field === step.field && !event.error);

            let statusClass = 'pending';
            if (isCompleted) statusClass = 'completed';
            else if (isCurrent) statusClass = 'current';

            return (
              <div key={step.field} className={`punch-step ${statusClass}`}>
                <div className="punch-step-indicator">
                  {isCompleted ? '✓' : isCurrent ? step.icon : (index + 1)}
                </div>
                <div className="punch-step-info">
                  <div className="punch-step-label">{step.label}</div>
                  <div className="punch-step-time">
                    {isCompleted ? formatTime(value) : isCurrent ? 'Aguardando registro' : '—'}
                    {queued && !queued.serverSaved && ' · Pendente de envio'}
                  </div>
                  {(step.field === 'entrada' || step.field === 'saida') && (
                    <PunchLocation
                      location={todayRecord?.[`${step.field}_localizacao`]}
                      punched={isCompleted}
                      label={step.field === 'entrada' ? 'entrada' : 'saída'}
                      now={currentTime}
                      pending={queued && !queued.locationDone && currentTime.getTime() < queued.locationDeadline}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      </div>
    </div>
  );
}
