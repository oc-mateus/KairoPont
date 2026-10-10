import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatMinutesAsHours, getOvertimeMinutes, getTodayInSP } from '../../lib/utils';
import { Spinner } from '../../components/ui';
import { getAssignedShiftId, inferShiftFromEntry, makeEmployeeSchedule } from '../../lib/workShifts';

const ATTENDANCE_TRACKING_START = '2026-10-06';

function Icon({ children, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

const UsersIcon = () => <Icon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Icon>;
const ClockIcon = () => <Icon><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></Icon>;
const FileIcon = () => <Icon><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></Icon>;
const ArrowIcon = () => <Icon size={16}><polyline points="9 18 15 12 9 6"/></Icon>;

function isoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthOffset(yearMonth, offset) {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthShort(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1))).replace('.', '');
}

async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function clockMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function isVacationDay(vacations, employeeId, date) {
  return vacations.some((vacation) => vacation.funcionario_id === employeeId
    && vacation.data_inicio <= date && (vacation.data_retorno || vacation.data_fim) > date);
}

function isCltEmployee(employee) {
  return employee.tipo_contrato === 'clt' && employee.role !== 'admin';
}

function buildAttendanceChartData({ employees, records, vacations, today, periodStartMonth, periodStart, periodMonthCount, monthlyBuckets }) {
  if (!periodStartMonth) return [];
  const [startYear, startMonth] = periodStartMonth.split('-').map(Number);
  const startMonthIndex = startYear * 12 + startMonth - 1;
  const bucketCount = monthlyBuckets ? periodMonthCount : Math.ceil(new Date(startYear, startMonth, 0).getDate() / 7);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketMonth = monthOffset(periodStartMonth, index);
    const daysInMonth = new Date(startYear, startMonth, 0).getDate();
    return {
      label: monthlyBuckets ? formatMonthShort(bucketMonth) : `${index * 7 + 1}–${Math.min((index + 1) * 7, daysInMonth)}`,
      fullLabel: monthlyBuckets ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(startYear, startMonth - 1 + index, 1))) : `Dias ${index * 7 + 1} a ${Math.min((index + 1) * 7, daysInMonth)}`,
      absences: 0,
      delays: 0,
      overtimeMinutes: 0,
    };
  });
  const scheduledEmployees = employees.filter((employee) => isCltEmployee(employee) && employee.ativo && getAssignedShiftId(employee.escala_trabalho));
  const recordByEmployeeDay = new Map(records.map((record) => [`${record.funcionario_id}:${record.data}`, record]));
  const employeeById = new Map(scheduledEmployees.map((employee) => [employee.id, employee]));

  const daysToScan = monthlyBuckets
    ? Math.max(0, Math.floor((new Date(`${today}T12:00:00Z`) - new Date(`${periodStart}T12:00:00Z`)) / 86400000) + 1)
    : new Date(startYear, startMonth, 0).getDate();
  for (let offset = 0; offset < daysToScan; offset += 1) {
    const date = isoDate(startYear, startMonth - 1, offset + 1);
    if (monthlyBuckets && date > today) break;
    const monthNumber = Number(date.slice(5, 7));
    const bucketIndex = monthlyBuckets
      ? (Number(date.slice(0, 4)) * 12 + monthNumber - 1) - startMonthIndex
      : Math.floor((Number(date.slice(8, 10)) - 1) / 7);
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;
    const weekday = new Date(`${date}T12:00:00`).getDay() || 7;
    if (date < today && date >= ATTENDANCE_TRACKING_START) {
      scheduledEmployees.forEach((employee) => {
        if (employee.data_admissao && employee.data_admissao > date) return;
        const schedule = employee.escala_trabalho;
        if (!schedule?.dias_semana?.includes(weekday)) return;
        if (isVacationDay(vacations, employee.id, date)) return;
        const record = recordByEmployeeDay.get(`${employee.id}:${date}`);
        if (!record?.entrada) bucket.absences += 1;
      });
    }
  }

  records.forEach((record) => {
    if (!record.entrada) return;
    const employee = employeeById.get(record.funcionario_id);
    if (!employee) return;
    const recordMonthIndex = Number(record.data.slice(0, 4)) * 12 + Number(record.data.slice(5, 7)) - 1;
    const bucketIndex = monthlyBuckets ? recordMonthIndex - startMonthIndex : Math.floor((Number(record.data.slice(8, 10)) - 1) / 7);
    const bucket = buckets[bucketIndex];
    if (!bucket) return;
    const shiftId = record.turno_trabalhado || inferShiftFromEntry(record.entrada) || getAssignedShiftId(employee.escala_trabalho);
    const weekday = new Date(`${record.data}T12:00:00`).getDay() || 7;
    const shiftDay = makeEmployeeSchedule(shiftId)?.horarios_por_dia?.[String(weekday)];
    const expectedEntry = clockMinutes(shiftDay?.entrada);
    const actualEntry = clockMinutes(record.entrada);
    if (expectedEntry != null && actualEntry != null && actualEntry > expectedEntry) bucket.delays += 1;
    bucket.overtimeMinutes += getOvertimeMinutes(record, shiftId);
  });

  return buckets;
}

function AttendanceChart({ title, total, unit, values, color, groupLabel, formatValue = (value) => String(value) }) {
  const maximum = Math.max(1, ...values.map((item) => item.value));
  return (
    <article className="attendance-chart-card">
      <header><div><h4>{title}</h4><p>{groupLabel}</p></div><strong>{total}<small>{unit}</small></strong></header>
      <div className="attendance-chart-bars" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }} role="img" aria-label={`${title}, ${groupLabel}`}>
        {values.map((item) => (
          <div className="attendance-chart-column" key={item.label} title={`${item.fullLabel || item.label}: ${formatValue(item.value)}`}>
            <div className="attendance-chart-track"><span className="attendance-chart-bar" style={{ height: `${Math.max(item.value > 0 ? 4 : 0, (item.value / maximum) * 100)}%`, background: color }} /></div>
            <strong>{formatValue(item.value)}</strong><small>{item.label}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [todayPunches, setTodayPunches] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const today = getTodayInSP();
  const [period, setPeriod] = useState('current');
  const [selectedMonth, setSelectedMonth] = useState(() => getTodayInSP().slice(0, 7));
  const periodMonthCount = period === '6m' ? 6 : period === '12m' ? 12 : 1;
  const periodStartMonth = period === 'specific' ? selectedMonth : monthOffset(today.slice(0, 7), -(periodMonthCount - 1));
  const periodStart = periodStartMonth ? `${periodStartMonth}-01` : '';
  const selectedMonthEnd = selectedMonth
    ? `${selectedMonth}-${String(new Date(Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`
    : '';
  const periodEnd = period === 'specific' && selectedMonthEnd
    ? (selectedMonthEnd < today ? selectedMonthEnd : today)
    : today;
  const monthlyBuckets = period === '6m' || period === '12m';

  useEffect(() => {
    async function fetchOverview() {
      setLoading(true);
      try {
        const [employeesResult, documentsResult] = await Promise.all([
          supabase.from('funcionarios').select('*').order('nome'),
          supabase.from('documentos').select('*').order('created_at', { ascending: false }),
        ]);
        if (employeesResult.error) throw employeesResult.error;
        if (documentsResult.error) throw documentsResult.error;
        setEmployees(employeesResult.data || []);
        setDocuments(documentsResult.data || []);
      } catch (error) {
        console.error('Erro ao carregar painel administrativo:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchOverview();
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAttendance() {
      setAttendanceLoading(true);
      if (!periodStart) {
        setRecords([]);
        setVacations([]);
        setTodayPunches([]);
        setAttendanceLoading(false);
        return;
      }
      try {
        const [periodRecords, vacationsResult, todayRows] = await Promise.all([
          fetchAllRows(() => supabase.from('registros_ponto').select('*').gte('data', periodStart).lte('data', periodEnd).order('data', { ascending: false }).order('funcionario_id')),
          supabase.from('solicitacoes_ferias').select('funcionario_id,data_inicio,data_retorno,data_fim,status').eq('status', 'aprovada').lt('data_inicio', today).gte('data_retorno', periodStart),
          fetchAllRows(() => supabase.from('registros_ponto').select('funcionario_id').eq('data', today).order('funcionario_id')),
        ]);
        if (vacationsResult.error) throw vacationsResult.error;
        if (cancelled) return;
        setRecords(periodRecords);
        setVacations(vacationsResult.data || []);
        setTodayPunches(todayRows);
      } catch (error) {
        if (!cancelled) {
          console.error('Erro ao carregar indicadores de ponto:', error);
          setRecords([]);
          setVacations([]);
          setTodayPunches([]);
        }
      } finally {
        if (!cancelled) setAttendanceLoading(false);
      }
    }
    fetchAttendance();
    return () => { cancelled = true; };
  }, [periodStart, periodEnd, today]);

  const cltEmployees = employees.filter(isCltEmployee);
  const activeCltEmployees = cltEmployees.filter((employee) => employee.ativo);
  const activeCltEmployeeIds = new Set(activeCltEmployees.map((employee) => employee.id));
  const todayRecords = todayPunches.filter((record) => activeCltEmployeeIds.has(record.funcionario_id)).length;
  const chartData = useMemo(() => buildAttendanceChartData({
    employees, records, vacations, today, periodStartMonth, periodStart, periodMonthCount, monthlyBuckets,
  }), [employees, records, vacations, today, periodStartMonth, periodStart, periodMonthCount, monthlyBuckets]);

  const absenceTotal = chartData.reduce((total, item) => total + item.absences, 0);
  const delayTotal = chartData.reduce((total, item) => total + item.delays, 0);
  const overtimeTotal = chartData.reduce((total, item) => total + item.overtimeMinutes, 0);
  const hasSpecificCltRecords = records.some((record) => activeCltEmployeeIds.has(record.funcionario_id));
  const selectedEmployee = activeCltEmployees.find((employee) => employee.id === selectedEmployeeId) || null;
  const individualChartData = useMemo(() => selectedEmployee ? buildAttendanceChartData({
    employees: [selectedEmployee], records, vacations, today, periodStartMonth, periodStart, periodMonthCount, monthlyBuckets,
  }) : [], [selectedEmployee, records, vacations, today, periodStartMonth, periodStart, periodMonthCount, monthlyBuckets]);
  const individualAbsenceTotal = individualChartData.reduce((total, item) => total + item.absences, 0);
  const individualDelayTotal = individualChartData.reduce((total, item) => total + item.delays, 0);
  const individualOvertimeTotal = individualChartData.reduce((total, item) => total + item.overtimeMinutes, 0);

  if (loading) return <div className="flex flex-center" style={{ minHeight: '60vh' }}><Spinner size="lg" /></div>;

  return (
    <div className="admin-dashboard">
      <div className="page-header admin-page-heading">
        <div><span className="eyebrow">Administração</span><h2 className="page-title">Visão geral</h2><p className="page-subtitle">Indicadores de frequência e jornada dos funcionários CLT.</p></div>
        <span className="admin-date">Hoje, {new Date(`${today}T12:00:00`).toLocaleDateString('pt-BR')}</span>
      </div>

      <div className="admin-summary-grid">
        <Link className="admin-summary-card" to="/admin/funcionarios"><span className="admin-summary-icon"><UsersIcon /></span><span className="admin-summary-content"><span>Funcionários CLT ativos</span><strong>{activeCltEmployees.length}<small> de {cltEmployees.length}</small></strong></span><ArrowIcon /></Link>
        <div className="admin-summary-card"><span className="admin-summary-icon"><ClockIcon /></span><span className="admin-summary-content"><span>Registros CLT hoje</span><strong>{todayRecords}<small> marcações</small></strong></span></div>
        <div className="admin-summary-card"><span className="admin-summary-icon"><FileIcon /></span><span className="admin-summary-content"><span>Documentos enviados</span><strong>{documents.length}<small> arquivos</small></strong></span></div>
      </div>

      <section className="admin-people-section attendance-insights-section">
        <div className="section-heading attendance-section-heading">
          <div><h3>Absenteísmo e jornada</h3></div>
          <div className="attendance-heading-actions">
            <div className="attendance-period-control">
              <span>Período</span>
              <div className="attendance-period-switch" role="group" aria-label="Período dos gráficos">
                <button type="button" className={period === 'current' ? 'active' : ''} aria-pressed={period === 'current'} onClick={() => setPeriod('current')}>Este mês</button>
                <button type="button" className={period === 'specific' ? 'active' : ''} aria-pressed={period === 'specific'} onClick={() => setPeriod('specific')}>Escolher mês</button>
                <button type="button" className={period === '6m' ? 'active' : ''} aria-pressed={period === '6m'} onClick={() => setPeriod('6m')}>6 meses</button>
                <button type="button" className={period === '12m' ? 'active' : ''} aria-pressed={period === '12m'} onClick={() => setPeriod('12m')}>1 ano</button>
              </div>
            </div>
            {period === 'specific' && <label className="attendance-month-control" title="Selecionar mês"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg><input type="month" aria-label="Mês específico" max={today.slice(0, 7)} value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label>}
            <Link to="/admin/funcionarios">Gerenciar funcionários <ArrowIcon /></Link>
          </div>
        </div>
        {attendanceLoading ? <p className="attendance-loading">Carregando indicadores…</p> : period === 'specific' && !selectedMonth ? <p className="attendance-loading">Selecione um mês para consultar os indicadores.</p> : period === 'specific' && !hasSpecificCltRecords ? <p className="attendance-loading">Não há registros de ponto de funcionários CLT para este mês.</p> : <div className="attendance-insights-grid">
          <AttendanceChart title="Faltas" total={absenceTotal} unit="dias" values={chartData.map(({ label, fullLabel, absences }) => ({ label, fullLabel, value: absences }))} groupLabel={monthlyBuckets ? 'Por mês' : 'Por semana'} color="var(--danger-500, #d95d5d)" />
          <AttendanceChart title="Atrasos" total={delayTotal} unit="registros" values={chartData.map(({ label, fullLabel, delays }) => ({ label, fullLabel, value: delays }))} groupLabel={monthlyBuckets ? 'Por mês' : 'Por semana'} color="var(--warning-500, #d99a35)" />
          <AttendanceChart title="Horas extras" total={formatMinutesAsHours(overtimeTotal)} unit="total" values={chartData.map(({ label, fullLabel, overtimeMinutes }) => ({ label, fullLabel, value: overtimeMinutes }))} groupLabel={monthlyBuckets ? 'Por mês' : 'Por semana'} color="var(--kairo-green-400, #35b76a)" formatValue={formatMinutesAsHours} />
        </div>}
      </section>

      <section className="admin-people-section attendance-employee-section">
        <div className="section-heading attendance-section-heading">
          <div>
            <h3>Indicadores por funcionário</h3>
            <p>Consulte faltas, atrasos e horas extras de um funcionário CLT no mesmo período acima.</p>
          </div>
          <label className="attendance-employee-control">
            <span>Funcionário CLT</span>
            <select aria-label="Selecionar funcionário CLT" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
              <option value="">Selecione um funcionário</option>
              {activeCltEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nome}</option>)}
            </select>
          </label>
        </div>
        {attendanceLoading ? <p className="attendance-loading">Carregando indicadores…</p>
          : !selectedEmployee ? <p className="attendance-loading">Escolha um funcionário CLT para visualizar os gráficos individuais.</p>
            : period === 'specific' && !selectedMonth ? <p className="attendance-loading">Selecione um mês para consultar os indicadores.</p>
              : <>
                <div className="attendance-selected-employee"><span className="attendance-selected-avatar">{selectedEmployee.nome.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><span>Dados individuais de</span><strong>{selectedEmployee.nome}</strong></div><span className="attendance-contract-badge">CLT</span></div>
                <div className="attendance-insights-grid">
                  <AttendanceChart title="Faltas" total={individualAbsenceTotal} unit="dias" values={individualChartData.map(({ label, fullLabel, absences }) => ({ label, fullLabel, value: absences }))} groupLabel={monthlyBuckets ? 'Por mês' : 'Por semana'} color="var(--danger-500, #d95d5d)" />
                  <AttendanceChart title="Atrasos" total={individualDelayTotal} unit="registros" values={individualChartData.map(({ label, fullLabel, delays }) => ({ label, fullLabel, value: delays }))} groupLabel={monthlyBuckets ? 'Por mês' : 'Por semana'} color="var(--warning-500, #d99a35)" />
                  <AttendanceChart title="Horas extras" total={formatMinutesAsHours(individualOvertimeTotal)} unit="total" values={individualChartData.map(({ label, fullLabel, overtimeMinutes }) => ({ label, fullLabel, value: overtimeMinutes }))} groupLabel={monthlyBuckets ? 'Por mês' : 'Por semana'} color="var(--kairo-green-400, #35b76a)" formatValue={formatMinutesAsHours} />
                </div>
              </>}
      </section>
    </div>
  );
}
