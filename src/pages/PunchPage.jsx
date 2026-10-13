import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { formatTime, getTodayInSP, formatDate } from '../lib/utils';
import { Spinner, Badge } from '../components/ui';
import { getAssignedShiftId, getFixedLunchLabel, getShiftLabel } from '../lib/workShifts';

export const PunchInIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>;
export const LunchOutIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>;
export const LunchInIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 11 12 16 7"/><line x1="11" y1="12" x2="21" y2="12"/></svg>;
export const PunchOutIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
export const CompleteIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
export const BlockIcon = <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>;

const PUNCH_STEPS = [
  { field: 'entrada', label: 'Entrada', icon: PunchInIcon, description: 'Registrar entrada na empresa' },
  { field: 'saida_almoco', label: 'Saída para almoço', icon: LunchOutIcon, description: 'Registrar início da pausa de almoço' },
  { field: 'retorno_almoco', label: 'Retorno do almoço', icon: LunchInIcon, description: 'Registrar retorno após uma hora de almoço' },
  { field: 'saida', label: 'Saída', icon: PunchOutIcon, description: 'Registrar saída da empresa' },
];

function timestampForClock(date, clock, referenceClock) {
  const [hours, minutes] = String(clock).slice(0, 5).split(':').map(Number);
  const [referenceHours, referenceMinutes] = String(referenceClock).slice(0, 5).split(':').map(Number);
  let timestamp = Date.parse(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-03:00`);
  if (hours * 60 + minutes < referenceHours * 60 + referenceMinutes) timestamp += 24 * 60 * 60 * 1000;
  return timestamp;
}

function previousIsoDate(date) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() - 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export default function PunchPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const [todayRecord, setTodayRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [cooldown, setCooldown] = useState(false);

  // Atualiza relógio a cada segundo
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Busca o registro do dia
  const fetchTodayRecord = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const todayDate = getTodayInSP();
      const { data: todayRecord, error } = await supabase
        .from('registros_ponto')
        .select('*')
        .eq('funcionario_id', profile.id)
        .eq('data', todayDate)
        .maybeSingle();

      if (error) throw error;
      if (todayRecord) {
        setTodayRecord(todayRecord);
      } else {
        let previousQuery = supabase
          .from('registros_ponto')
          .select('*')
          .eq('funcionario_id', profile.id)
          .eq('data', previousIsoDate(todayDate))
          .is('saida', null);
        if (profile.tipo_contrato !== 'pj') previousQuery = previousQuery.eq('turno_trabalhado', 'turno3');
        const { data: previous, error: previousError } = await previousQuery.maybeSingle();
        if (previousError) throw previousError;
        setTodayRecord(previous);
      }
    } catch (err) {
      toast.error('Erro ao carregar registro do dia: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, profile?.tipo_contrato]);

  useEffect(() => {
    fetchTodayRecord();
  }, [fetchTodayRecord]);

  const assignedShiftId = getAssignedShiftId(profile?.escala_trabalho);
  const recordShiftId = todayRecord?.turno_trabalhado || assignedShiftId;
  const hasFixedLunch = todayRecord
    ? getFixedLunchLabel(recordShiftId, todayRecord.data) !== 'Sem intervalo'
    : false;
  const needsDynamicLunch = profile?.tipo_contrato !== 'pj' && Boolean(todayRecord) && !hasFixedLunch;
  const entryTimestamp = todayRecord?.entrada
    ? Date.parse(`${todayRecord.data}T${String(todayRecord.entrada).slice(0, 5)}:00-03:00`)
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

  // Registra o ponto usando RPC no servidor (horário gerado no Supabase)
  const handlePunch = async (fieldOverride = null) => {
    if (isComplete || punching || cooldown || waitingForLunchReturn) return;

    // Prevenção de clique duplo
    setCooldown(true);
    setTimeout(() => setCooldown(false), 3000);

    setPunching(true);
    try {
      const step = fieldOverride ? PUNCH_STEPS.find((item) => item.field === fieldOverride) : punchSteps[nextStepIndex];
      const { data, error } = await supabase.rpc('registrar_ponto', {
        p_funcionario_id: profile.id,
        p_tipo: step.field,
      });

      if (error) throw error;

      toast.success(`${step.label} registrada com sucesso!`);
      await fetchTodayRecord();
    } catch (err) {
      toast.error('Erro ao registrar ponto: ' + err.message);
    } finally {
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

  if (loading) {
    return (
      <div className="flex flex-col flex-center" style={{ minHeight: '60vh' }}>
        <Spinner size="lg" />
        <p className="text-muted mt-4">Carregando registro do dia...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Clock display */}
      <div className="text-center mb-6">
        <div style={{
          fontSize: 'clamp(2.5rem, 8vw, 4rem)',
          fontWeight: 800,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {displayTime}
        </div>
        <div style={{
          fontSize: 'var(--font-sm)',
          color: 'var(--text-muted)',
          textTransform: 'capitalize',
        }}>
          {displayDate}
        </div>
      </div>

      <div className="punch-employment-line">
        <Badge variant="info">Vínculo: {profile?.tipo_contrato === 'pj' ? 'PJ' : 'CLT'}</Badge>
        {profile?.tipo_contrato !== 'pj' && profile?.escala_trabalho && <Badge variant="neutral">Turno: {getShiftLabel(getAssignedShiftId(profile.escala_trabalho))}</Badge>}
      </div>

      {profile?.tipo_contrato === 'pj' && <div className="pj-punch-note">Registro de ponto PJ: marque somente a entrada e a saída do seu período de trabalho.</div>}

      {/* Punch button */}
      <div className="flex flex-center mb-6" style={{ flexDirection: 'column', gap: 'var(--space-4)' }}>
        <button
          className="btn-punch"
          onClick={handlePunch}
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

        {!isComplete && profile?.ativo && (
          <p className="text-muted" style={{ fontSize: 'var(--font-sm)' }}>
            Próximo: <strong>{punchSteps[nextStepIndex].description}</strong>
          </p>
        )}

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
          <p className="text-muted" style={{ fontSize: 'var(--font-sm)', maxWidth: '500px', textAlign: 'center' }}>
            Se o tempo trabalhado ultrapassar 6 horas, é necessário registrar uma pausa de almoço de 1 hora antes da saída.
            {waitingForLunchReturn && ` O retorno poderá ser registrado em ${Math.ceil(60 - breakMinutes)} min.`}
          </p>
        )}

        {cooldown && !punching && (
          <p className="text-muted" style={{ fontSize: 'var(--font-xs)' }}>
            Aguarde alguns segundos antes de registrar novamente...
          </p>
        )}
      </div>

      {/* Timeline do dia */}
      <div className="card" style={{ maxWidth: '500px', margin: '0 auto' }}>
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
