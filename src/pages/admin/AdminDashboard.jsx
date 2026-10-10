import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatMinutesAsHours, getOvertimeMinutes, getTodayInSP } from '../../lib/utils';
import { Spinner } from '../../components/ui';
import { getAssignedShiftId, inferShiftFromEntry, makeEmployeeSchedule } from '../../lib/workShifts';

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

function AttendanceChart({ title, total, unit, values, color, formatValue = (value) => String(value) }) {
  const maximum = Math.max(1, ...values.map((item) => item.value));
  return (
    <article className="attendance-chart-card">
      <header><div><h4>{title}</h4><p>Por semana do mês atual</p></div><strong>{total}<small>{unit}</small></strong></header>
      <div className="attendance-chart-bars" role="img" aria-label={`${title}, semana a semana`}>
        {values.map((item) => (
          <div className="attendance-chart-column" key={item.label} title={`${item.label}: ${formatValue(item.value)}`}>
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
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [vacations, setVacations] = useState([]);
  const today = getTodayInSP();

  useEffect(() => {
    async function fetchOverview() {
      setLoading(true);
      try {
        const monthStart = `${today.slice(0, 7)}-01`;
        const [employeesResult, recordsResult, documentsResult, vacationsResult] = await Promise.all([
          supabase.from('funcionarios').select('*').order('nome'),
          supabase.from('registros_ponto').select('*').gte('data', monthStart).lte('data', today).order('data', { ascending: false }),
          supabase.from('documentos').select('*').order('created_at', { ascending: false }),
          supabase.from('solicitacoes_ferias').select('funcionario_id,data_inicio,data_retorno,data_fim,status').eq('status', 'aprovada').lt('data_inicio', today).gte('data_retorno', monthStart),
        ]);
        if (employeesResult.error) throw employeesResult.error;
        if (recordsResult.error) throw recordsResult.error;
        if (documentsResult.error) throw documentsResult.error;
        if (vacationsResult.error) throw vacationsResult.error;
        setEmployees(employeesResult.data || []);
        setRecords(recordsResult.data || []);
        setDocuments(documentsResult.data || []);
        setVacations(vacationsResult.data || []);
      } catch (error) {
        console.error('Erro ao carregar painel administrativo:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchOverview();
  }, [today]);

  const cltEmployees = employees.filter(isCltEmployee);
  const activeCltEmployees = cltEmployees.filter((employee) => employee.ativo);
  const activeCltEmployeeIds = new Set(activeCltEmployees.map((employee) => employee.id));
  const todayRecords = records.filter((record) => record.data === today && activeCltEmployeeIds.has(record.funcionario_id)).length;
  const chartData = useMemo(() => {
    const [year, month] = today.split('-').map(Number);
    const monthIndex = month - 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const weeks = Array.from({ length: Math.ceil(daysInMonth / 7) }, (_, index) => ({
      label: `${index * 7 + 1}–${Math.min((index + 1) * 7, daysInMonth)}`,
      absences: 0,
      delays: 0,
      overtimeMinutes: 0,
    }));
    const scheduledEmployees = employees.filter((employee) => isCltEmployee(employee) && employee.ativo && getAssignedShiftId(employee.escala_trabalho));
    const recordByEmployeeDay = new Map(records.map((record) => [`${record.funcionario_id}:${record.data}`, record]));
    const employeeById = new Map(scheduledEmployees.map((employee) => [employee.id, employee]));

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = isoDate(year, monthIndex, day);
      const weekday = new Date(`${date}T12:00:00`).getDay() || 7;
      const bucket = weeks[Math.floor((day - 1) / 7)];
      if (date < today) {
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
      const day = Number(record.data.slice(8, 10));
      const bucket = weeks[Math.floor((day - 1) / 7)];
      if (!bucket) return;
      const shiftId = record.turno_trabalhado || inferShiftFromEntry(record.entrada) || getAssignedShiftId(employee.escala_trabalho);
      const weekday = new Date(`${record.data}T12:00:00`).getDay() || 7;
      const shiftDay = makeEmployeeSchedule(shiftId)?.horarios_por_dia?.[String(weekday)];
      const expectedEntry = clockMinutes(shiftDay?.entrada);
      const actualEntry = clockMinutes(record.entrada);
      if (expectedEntry != null && actualEntry != null && actualEntry > expectedEntry) bucket.delays += 1;
      bucket.overtimeMinutes += getOvertimeMinutes(record, shiftId);
    });

    return weeks;
  }, [employees, records, today, vacations]);

  const absenceTotal = chartData.reduce((total, item) => total + item.absences, 0);
  const delayTotal = chartData.reduce((total, item) => total + item.delays, 0);
  const overtimeTotal = chartData.reduce((total, item) => total + item.overtimeMinutes, 0);

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
        <div className="section-heading"><div><h3>Absenteísmo e jornada</h3><p>Mês atual · somente CLT ativos com turno cadastrado · faltas até ontem, sem férias aprovadas.</p></div><Link to="/admin/funcionarios">Gerenciar funcionários <ArrowIcon /></Link></div>
        <div className="attendance-insights-grid">
          <AttendanceChart title="Faltas" total={absenceTotal} unit="dias" values={chartData.map(({ label, absences }) => ({ label, value: absences }))} color="var(--danger-500, #d95d5d)" />
          <AttendanceChart title="Atrasos" total={delayTotal} unit="registros" values={chartData.map(({ label, delays }) => ({ label, value: delays }))} color="var(--warning-500, #d99a35)" />
          <AttendanceChart title="Horas extras" total={formatMinutesAsHours(overtimeTotal)} unit="total" values={chartData.map(({ label, overtimeMinutes }) => ({ label, value: overtimeMinutes }))} color="var(--kairo-green-400, #35b76a)" formatValue={formatMinutesAsHours} />
        </div>
      </section>
    </div>
  );
}
