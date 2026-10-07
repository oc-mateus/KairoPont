import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { calcDailyTotal, formatCPF, formatDate, formatDateTime, formatTime, getTodayInSP, maskCPF } from '../../lib/utils';
import { Spinner, Badge, Avatar, ConfirmDialog } from '../../components/ui';
import { addKairoPdfHeader } from '../../lib/pdfBranding';
import { downloadTimesheetXlsx } from '../../lib/exportTimesheetXlsx';
import WorkScheduleCard from '../../components/WorkScheduleCard';
import { getAssignedShiftId, getShiftLabel, inferShiftFromEntry, makeEmployeeSchedule, WORK_SHIFTS } from '../../lib/workShifts';

const FILTERS = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
  { id: 'custom', label: 'Período personalizado' },
];
const PUNCH_EDIT_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

function canEditPunch(record) {
  const createdAt = Date.parse(record?.created_at || '');
  return Number.isFinite(createdAt) && Date.now() < createdAt + PUNCH_EDIT_WINDOW_MS;
}

function timeInputValue(value) {
  return value ? String(value).slice(0, 5) : '';
}

function addIsoDays(value, days) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function getRange(filter, selectedDay, customStart, customEnd, referenceDate) {
  if (filter === 'day') return { start: selectedDay, end: selectedDay };
  if (filter === 'week') {
    const { start, end } = getCurrentWeekRangeForDate(referenceDate);
    return { start, end };
  }
  if (filter === 'month') {
    const [year, month] = referenceDate.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { start: `${year}-${String(month).padStart(2, '0')}-01`, end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
  }
  return { start: customStart, end: customEnd };
}

function getCurrentWeekRangeForDate(dateValue) {
  const date = new Date(`${dateValue}T12:00:00`);
  const dayOfWeek = date.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const asIsoDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return { start: asIsoDate(monday), end: asIsoDate(sunday) };
}

async function fetchAllRows(buildQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function safeFilename(name) {
  return (name || 'funcionario').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function timeMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function durationLabel(minutes) {
  if (minutes == null) return '—';
  const sign = minutes < 0 ? '−' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${Math.floor(absolute / 60)}h ${String(absolute % 60).padStart(2, '0')}min`;
}

function getScheduleComparison(record, schedule) {
  if (!schedule?.dias_semana?.length) return { expected: '—', balance: '—' };
  const weekday = new Date(`${record.data}T12:00:00`).getDay() || 7;
  if (!schedule.dias_semana.includes(weekday)) return { expected: 'Folga', balance: record.saida ? 'Extra' : '—' };
  const actualShiftId = record.turno_trabalhado || inferShiftFromEntry(record.entrada);
  const shiftDay = weekday !== 6 && actualShiftId ? makeEmployeeSchedule(actualShiftId).horarios_por_dia[String(weekday)] : null;
  const daily = weekday === 6
    ? { entrada: '08:00', saida: '12:00' }
    : shiftDay || schedule.horarios_por_dia?.[String(weekday)] || schedule;
  const entry = timeMinutes(daily.entrada);
  const lunchOut = timeMinutes(daily.saida_almoco);
  const lunchIn = timeMinutes(daily.retorno_almoco);
  const exit = timeMinutes(daily.saida);
  let expectedMinutes = entry != null && exit != null ? (lunchOut != null && lunchIn != null ? (lunchOut - entry) + (exit - lunchIn) : exit - entry) : null;
  if (expectedMinutes != null && expectedMinutes < 0) expectedMinutes += 24 * 60;
  const actualEntry = timeMinutes(record.entrada);
  const actualLunchOut = timeMinutes(record.saida_almoco);
  const actualLunchIn = timeMinutes(record.retorno_almoco);
  const actualExit = timeMinutes(record.saida);
  let actualMinutes = actualEntry != null && actualExit != null ? (actualLunchOut != null && actualLunchIn != null ? (actualLunchOut - actualEntry) + (actualExit - actualLunchIn) : actualExit - actualEntry) : null;
  if (actualMinutes != null && actualMinutes < 0 && (record.saida_data > record.data || record.turno_trabalhado === 'turno3')) actualMinutes += 24 * 60;
  const expected = expectedMinutes == null ? '—' : `${Math.floor(expectedMinutes / 60)}h ${String(expectedMinutes % 60).padStart(2, '0')}min`;
  return { expected, balance: durationLabel(actualMinutes == null || expectedMinutes == null ? null : actualMinutes - expectedMinutes) };
}

export default function AdminEmployees() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [editingPunchId, setEditingPunchId] = useState(null);
  const [punchEditForm, setPunchEditForm] = useState({ entrada: '', saida_almoco: '', retorno_almoco: '', saida: '', saida_data: '' });
  const [savingPunch, setSavingPunch] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [vacationPeriods, setVacationPeriods] = useState([]);
  const [vacationRequests, setVacationRequests] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [filter, setFilter] = useState('month');
  const [selectedDay, setSelectedDay] = useState(getTodayInSP());
  const [referenceDate, setReferenceDate] = useState(getTodayInSP());
  const [customStart, setCustomStart] = useState(getTodayInSP());
  const [customEnd, setCustomEnd] = useState(getTodayInSP());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionType, setActionType] = useState('');
  const [actionEmployee, setActionEmployee] = useState(null);
  const [downloadingDocument, setDownloadingDocument] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [savingEmployment, setSavingEmployment] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [editingAdmission, setEditingAdmission] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({ nome: '', email: '', cpf: '', cargo: '', data_admissao: getTodayInSP(), turno_id: 'turno1', ...makeEmployeeSchedule('turno1') });

  const hasSavedSchedule = Boolean(selectedEmp?.escala_trabalho?.dias_semana?.length || (selectedEmp?.escala_trabalho?.entrada && selectedEmp?.escala_trabalho?.saida));

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('funcionarios').select('*').order('nome');
      if (error) throw error;
      setEmployees(data || []);
    } catch (error) {
      toast.error('Erro ao carregar funcionários: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEmployees(); }, []);

  useEffect(() => {
    if (selectedEmp) {
      setEmployeeForm(formFromEmployee(selectedEmp));
      const savedSchedule = selectedEmp.escala_trabalho;
      setEditingSchedule(!(savedSchedule?.dias_semana?.length || (savedSchedule?.entrada && savedSchedule?.saida)));
      setEditingAdmission(!selectedEmp.data_admissao);
    }
  }, [selectedEmp]);

  useEffect(() => {
    const employeeId = searchParams.get('funcionario');
    if (!employeeId) {
      setSelectedEmp(null);
      return;
    }
    const employee = employees.find((item) => item.id === employeeId);
    if (employee) setSelectedEmp(employee);
  }, [employees, searchParams]);

  const openEmployee = (employee) => {
    setSelectedEmp(employee);
    setSearchParams({ funcionario: employee.id });
  };

  const closeEmployee = () => {
    setSelectedEmp(null);
    setSearchParams({});
  };

  const setFormField = (field, value) => setEmployeeForm((current) => ({ ...current, [field]: value }));

  const setScheduleType = (turnoId) => setEmployeeForm((current) => ({ ...current, ...makeEmployeeSchedule(turnoId), turno_id: turnoId }));

  const scheduleFromForm = (form) => makeEmployeeSchedule(form.turno_id || form.tipo || 'turno1');

  const formFromEmployee = (employee) => {
    const schedule = employee.escala_trabalho || {};
    const shiftId = WORK_SHIFTS[schedule.turno_id || schedule.tipo] ? (schedule.turno_id || schedule.tipo) : inferShiftFromEntry(schedule.horarios_por_dia?.['1']?.entrada || schedule.entrada) || 'turno1';
    return {
      nome: employee.nome || '', email: employee.email || '', cpf: formatCPF(employee.cpf) || '', cargo: employee.cargo || '',
      data_admissao: employee.data_admissao || '', turno_id: shiftId, ...makeEmployeeSchedule(shiftId),
    };
  };

  const inviteEmployee = async (event) => {
    event.preventDefault();
    setSavingEmployment(true);
    try {
      const { error } = await supabase.functions.invoke('invite-employee', {
        body: { ...employeeForm, cpf: employeeForm.cpf.replace(/\D/g, ''), escala_trabalho: scheduleFromForm(employeeForm) },
      });
      if (error) throw error;
      toast.success('Convite enviado. O funcionário receberá um e-mail para definir a senha.');
      setShowInviteForm(false);
      setEmployeeForm({ nome: '', email: '', cpf: '', cargo: '', data_admissao: getTodayInSP(), turno_id: 'turno1', ...makeEmployeeSchedule('turno1') });
      await fetchEmployees();
    } catch (error) {
      toast.error(error.message || 'Não foi possível enviar o convite.');
    } finally {
      setSavingEmployment(false);
    }
  };

  const saveEmployment = async (event) => {
    event.preventDefault();
    setSavingEmployment(true);
    try {
      const { error } = await supabase.rpc('admin_update_employee_employment', {
        p_funcionario_id: selectedEmp.id,
        p_data_admissao: employeeForm.data_admissao,
        p_escala_trabalho: scheduleFromForm(employeeForm),
      });
      if (error) throw error;
      toast.success('Data de admissão e turno habitual atualizados.');
      await fetchEmployees();
      const { data } = await supabase.from('funcionarios').select('*').eq('id', selectedEmp.id).maybeSingle();
      if (data) setSelectedEmp(data);
      setEditingSchedule(false);
      setEditingAdmission(false);
    } catch (error) {
      toast.error('Não foi possível salvar: ' + error.message);
    } finally {
      setSavingEmployment(false);
    }
  };

  const employmentForm = (onSubmit, submitLabel) => (
    <form className="vacation-form employee-employment-form" onSubmit={onSubmit}>
      {showInviteForm && <div className="form-row"><label className="form-group">Nome completo<input className="form-input" required minLength={3} value={employeeForm.nome} onChange={(event) => setFormField('nome', event.target.value)} /></label><label className="form-group">E-mail corporativo<input className="form-input" required type="email" value={employeeForm.email} onChange={(event) => setFormField('email', event.target.value)} /></label></div>}
      {showInviteForm && <div className="form-row"><label className="form-group">CPF<input className="form-input" required inputMode="numeric" value={employeeForm.cpf} onChange={(event) => setFormField('cpf', maskCPF(event.target.value))} /></label><label className="form-group">Cargo<input className="form-input" required value={employeeForm.cargo} onChange={(event) => setFormField('cargo', event.target.value)} /></label></div>}
      {(!editingAdmission && !showInviteForm && selectedEmp?.data_admissao) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingAdmission(true)}>Editar data de admissão</button>}
      {(editingAdmission || showInviteForm || !selectedEmp?.data_admissao) && <label className="form-group">Data de admissão<input className="form-input" required type="date" max={getTodayInSP()} value={employeeForm.data_admissao} onChange={(event) => setFormField('data_admissao', event.target.value)} /></label>}
      {(!hasSavedSchedule || editingSchedule || showInviteForm) && <label className="form-group">Turno habitual<select className="form-input" value={employeeForm.turno_id} onChange={(event) => setScheduleType(event.target.value)}><option value="turno1">1º turno — 08:00 às 17:00</option><option value="turno2">2º turno — 14:00 às 22:45</option><option value="turno3">3º turno — 22:45 às 06:15 (dia seguinte)</option></select></label>}
      {hasSavedSchedule && !editingSchedule && !showInviteForm && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingSchedule(true)}>Editar turno</button>}
      {(editingAdmission || editingSchedule || !hasSavedSchedule || !selectedEmp?.data_admissao || showInviteForm) && <button className="btn btn-primary" disabled={savingEmployment || ((editingSchedule || !hasSavedSchedule || showInviteForm) && employeeForm.dias_semana.length === 0)}>{savingEmployment ? 'Salvando…' : editingSchedule || !hasSavedSchedule || showInviteForm ? submitLabel : 'Salvar data de admissão'}</button>}
    </form>
  );

  const range = useMemo(() => getRange(filter, selectedDay, customStart, customEnd, referenceDate), [filter, selectedDay, customStart, customEnd, referenceDate]);

  const startPunchEdit = (record) => {
    if (!canEditPunch(record)) {
      toast.error('O prazo de 4 dias para ajustar este registro já terminou.');
      return;
    }
    setEditingPunchId(record.id);
    setPunchEditForm({
      entrada: timeInputValue(record.entrada),
      saida_almoco: timeInputValue(record.saida_almoco),
      retorno_almoco: timeInputValue(record.retorno_almoco),
      saida: timeInputValue(record.saida),
      saida_data: record.saida ? (record.saida_data || record.data) : '',
    });
  };

  const savePunchEdit = async (event) => {
    event.preventDefault();
    if (!editingPunchId || savingPunch) return;
    setSavingPunch(true);
    try {
      const { error } = await supabase.rpc('admin_edit_punch_record', {
        p_record_id: editingPunchId,
        p_entrada: punchEditForm.entrada || null,
        p_saida_almoco: punchEditForm.saida_almoco || null,
        p_retorno_almoco: punchEditForm.retorno_almoco || null,
        p_saida: punchEditForm.saida || null,
        p_saida_data: punchEditForm.saida ? (punchEditForm.saida_data || null) : null,
      });
      if (error) throw error;
      const { data, error: fetchError } = await supabase.from('registros_ponto').select('*').eq('id', editingPunchId).single();
      if (fetchError) throw fetchError;
      setRecords((current) => current.map((record) => record.id === editingPunchId ? data : record));
      setEditingPunchId(null);
      toast.success('Horários do registro atualizados. A alteração ficou registrada na auditoria.');
    } catch (error) {
      toast.error(error.message?.includes('Prazo expirado')
        ? 'O prazo de 4 dias terminou. Este registro não pode mais ser alterado.'
        : 'Não foi possível atualizar o registro: ' + error.message);
    } finally {
      setSavingPunch(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function fetchEmployeeDetails() {
      if (!selectedEmp) {
        setRecords([]);
        setDocuments([]);
        setVacationPeriods([]);
        setVacationRequests([]);
        return;
      }
      const hasValidRange = Boolean(range.start && range.end && range.start <= range.end);
      setRecords([]);
      setDocuments([]);
      setVacationPeriods([]);
      setVacationRequests([]);
      setDetailLoading(true);
      try {
        const { error: syncError } = await supabase.rpc('sync_current_vacation_periods');
        if (syncError) throw syncError;
        const [employeeRecords, employeeDocuments, employeeCycles, employeeVacations] = await Promise.all([
          hasValidRange ? fetchAllRows(() => supabase.from('registros_ponto').select('*').eq('funcionario_id', selectedEmp.id).gte('data', range.start).lte('data', range.end).order('data', { ascending: false })) : Promise.resolve([]),
          fetchAllRows(() => supabase.from('documentos').select('*').eq('funcionario_id', selectedEmp.id).order('created_at', { ascending: false })),
          fetchAllRows(() => supabase.from('periodos_aquisitivos_ferias').select('*').eq('funcionario_id', selectedEmp.id).order('periodo_inicio', { ascending: false })),
          fetchAllRows(() => supabase.from('solicitacoes_ferias').select('*').eq('funcionario_id', selectedEmp.id).order('created_at', { ascending: false })),
        ]);
        if (!cancelled) {
          setRecords(employeeRecords);
          setDocuments(employeeDocuments);
          setVacationPeriods(employeeCycles);
          setVacationRequests(employeeVacations);
        }
      } catch (error) {
        if (!cancelled) toast.error('Erro ao carregar informações do funcionário: ' + error.message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }
    fetchEmployeeDetails();
    return () => { cancelled = true; };
  }, [selectedEmp, range.start, range.end]);

  const handleActionClick = (emp, type) => {
    setActionEmployee(emp);
    setActionType(type);
    setDialogOpen(true);
  };

  const confirmAction = async () => {
    if (!actionEmployee) return;
    try {
      const { error } = await supabase.rpc('admin_update_employee', {
        p_funcionario_id: actionEmployee.id,
        p_ativo: actionType === 'toggle_status' ? !actionEmployee.ativo : actionEmployee.ativo,
        p_role: actionType === 'toggle_role' ? (actionEmployee.role === 'admin' ? 'employee' : 'admin') : actionEmployee.role,
      });
      if (error) throw error;
      toast.success(actionType === 'toggle_status' ? `Status de ${actionEmployee.nome} alterado.` : `Perfil de ${actionEmployee.nome} atualizado.`);
      setDialogOpen(false);
      await fetchEmployees();
      const { data } = await supabase.from('funcionarios').select('*').eq('id', actionEmployee.id).maybeSingle();
      if (data && selectedEmp?.id === data.id) setSelectedEmp(data);
    } catch (error) {
      toast.error('Erro ao realizar ação: ' + error.message);
    }
  };

  const downloadEmployeeRecordsExcel = async () => {
    if (!records.length) return toast.error('Não há registros para baixar neste período.');
    setExportingExcel(true);
    try {
      await downloadTimesheetXlsx({
        records,
        title: `Registro de ponto - ${selectedEmp.nome}`,
        period: `Período: ${formatDate(`${range.start}T12:00:00`)} a ${formatDate(`${range.end}T12:00:00`)}`,
        filename: `ponto-${safeFilename(selectedEmp.nome)}-${range.start}-a-${range.end}.xlsx`,
        calcDailyTotal,
        extraColumns: [
          { key: 'shift', header: 'Turno trabalhado', width: 20, value: (record) => getShiftLabel(record.turno_trabalhado || inferShiftFromEntry(record.entrada)) },
          { key: 'exitDate', header: 'Data da saída', width: 17, value: (record) => record.saida_data && record.saida_data !== record.data ? formatDate(`${record.saida_data}T12:00:00`) : 'Mesmo dia' },
          { key: 'expected', header: 'Jornada prevista', width: 20, value: (record) => getScheduleComparison(record, selectedEmp.escala_trabalho).expected },
          { key: 'balance', header: 'Saldo diário', width: 17, value: (record) => getScheduleComparison(record, selectedEmp.escala_trabalho).balance },
        ],
      });
      toast.success('Planilha Excel baixada.');
    } catch (error) {
      toast.error('Erro ao gerar planilha Excel: ' + error.message);
    } finally {
      setExportingExcel(false);
    }
  };

  const downloadEmployeeRecordsPdf = async () => {
    if (!records.length) return toast.error('Não há registros para baixar neste período.');
    setExportingPdf(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const pdf = new jsPDF({ orientation: 'landscape' });
      const tableStartY = await addKairoPdfHeader(pdf, {
        title: `Relatório de ponto - ${selectedEmp.nome}`,
        details: [
          `CPF: ${formatCPF(selectedEmp.cpf)}`,
          `Período: ${formatDate(`${range.start}T12:00:00`)} a ${formatDate(`${range.end}T12:00:00`)}`,
          `Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        ],
      });
      autoTable(pdf, {
        startY: tableStartY + 3,
        head: [['Data', 'Entrada', 'Turno', 'Saída almoço', 'Retorno', 'Saída', 'Saída em', 'Total', 'Previsto', 'Saldo', 'Status']],
        body: records.map((record) => [
          formatDate(`${record.data}T12:00:00`), formatTime(record.entrada), getShiftLabel(record.turno_trabalhado || inferShiftFromEntry(record.entrada)), formatTime(record.saida_almoco),
          formatTime(record.retorno_almoco), formatTime(record.saida), record.saida_data && record.saida_data !== record.data ? formatDate(`${record.saida_data}T12:00:00`) : 'Mesmo dia', calcDailyTotal(record), getScheduleComparison(record, selectedEmp.escala_trabalho).expected,
          getScheduleComparison(record, selectedEmp.escala_trabalho).balance,
          record.saida ? 'Completo' : 'Incompleto',
        ]),
        theme: 'grid',
        headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [232, 245, 233] },
        styles: { cellPadding: 3 },
      });
      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.setTextColor(150);
        pdf.text(`Página ${page} de ${pageCount} - KairoPont © ${new Date().getFullYear()}`, 14, pdf.internal.pageSize.height - 10);
      }
      pdf.save(`ponto-${safeFilename(selectedEmp.nome)}-${range.start}-a-${range.end}.pdf`);
      toast.success('Relatório PDF baixado.');
    } catch (error) {
      toast.error('Erro ao gerar PDF: ' + error.message);
    } finally {
      setExportingPdf(false);
    }
  };

  const downloadDocument = async (doc) => {
    setDownloadingDocument(doc.id);
    try {
      const { data, error } = await supabase.storage.from('documentos').createSignedUrl(doc.caminho_storage, 60, { download: doc.nome_arquivo });
      if (error) throw error;
      const anchor = window.document.createElement('a');
      anchor.href = data.signedUrl;
      anchor.download = doc.nome_arquivo;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      toast.error('Erro ao baixar documento: ' + error.message);
    } finally {
      setDownloadingDocument(null);
    }
  };

  if (loading) return <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>;

  return (
    <div className="admin-employees-page">
      <div className="page-header">
        <div><h2 className="page-title">Funcionários</h2><p className="page-subtitle">Selecione um funcionário para ver os dados, documentos e registros de ponto.</p></div>
        {selectedEmp && <button className="btn btn-ghost" onClick={closeEmployee}>Voltar à lista</button>}
      </div>

      {!selectedEmp ? (
        <>
          <div className="flex justify-between gap-3 employee-list-toolbar"><button className="btn btn-primary" onClick={() => setShowInviteForm((value) => !value)}>{showInviteForm ? 'Cancelar' : 'Novo funcionário'}</button></div>
          {showInviteForm && <section className="employee-records-section"><h3>Convidar funcionário</h3><p className="page-subtitle">Enviaremos o convite para o e-mail informado, onde a pessoa poderá definir a própria senha.</p>{employmentForm(inviteEmployee, 'Enviar convite')}</section>}
        <div className="employee-select-list">
          {employees.map((emp) => (
            <article className="employee-select-card" key={emp.id}>
              <button className="employee-select-main" onClick={() => openEmployee(emp)} aria-label={`Abrir informações de ${emp.nome}`}>
                <Avatar src={emp.foto_url} name={emp.nome} />
                <span className="employee-select-copy"><strong>{emp.nome}</strong><small>{emp.cargo} · {emp.email}</small></span>
                <span className="employee-select-cpf">{formatCPF(emp.cpf)}</span>
                <Badge variant={emp.ativo ? 'success' : 'neutral'}>{emp.ativo ? 'Ativo' : 'Inativo'}</Badge>
                <span className="employee-select-arrow" aria-hidden="true">›</span>
              </button>
              <div className="employee-select-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => handleActionClick(emp, 'toggle_status')}>{emp.ativo ? 'Desativar' : 'Ativar'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleActionClick(emp, 'toggle_role')}>{emp.role === 'admin' ? 'Remover admin' : 'Tornar admin'}</button>
              </div>
            </article>
          ))}
          {!employees.length && <div className="empty-state"><h3 className="empty-state-title">Nenhum funcionário cadastrado</h3></div>}
        </div>
        </>
      ) : (
        <>
          <section className="employee-profile-card">
            <Avatar src={selectedEmp.foto_url} name={selectedEmp.nome} size="lg" />
            <div className="employee-profile-heading"><h3>{selectedEmp.nome}</h3><p>{selectedEmp.email}</p></div>
            <Badge variant={selectedEmp.ativo ? 'success' : 'neutral'}>{selectedEmp.ativo ? 'Ativo' : 'Inativo'}</Badge>
            <div className="employee-profile-fields">
              <div><span>Nome completo</span><strong>{selectedEmp.nome}</strong></div>
              <div><span>CPF</span><strong>{formatCPF(selectedEmp.cpf)}</strong></div>
              <div><span>Cargo</span><strong>{selectedEmp.cargo || 'Não informado'}</strong></div>
              <div><span>Perfil de acesso</span><strong>{selectedEmp.role === 'admin' ? 'Administrador' : 'Funcionário'}</strong></div>
              <div><span>Data de admissão</span><strong>{selectedEmp.data_admissao ? formatDate(`${selectedEmp.data_admissao}T12:00:00`) : 'Não informada'}</strong></div>
              <div><span>Turno habitual</span><strong>{selectedEmp.escala_trabalho ? getShiftLabel(getAssignedShiftId(selectedEmp.escala_trabalho)) : 'Não informado'}</strong></div>
            </div>
          </section>

          <section className="employee-records-section"><h3>Data de admissão e turno habitual</h3><p className="page-subtitle">Os horários são preenchidos automaticamente pelo turno escolhido. Todos trabalham aos sábados das 08:00 às 12:00, sem intervalo.</p>{employmentForm(saveEmployment, 'Salvar dados trabalhistas')}</section>
          <WorkScheduleCard schedule={selectedEmp.escala_trabalho} admissionDate={selectedEmp.data_admissao} />

          <section className="employee-records-section employee-vacation-section">
            <div className="employee-section-heading"><div><h3>Férias deste funcionário</h3><p>{vacationPeriods.length} período(s) aquisitivo(s) · {vacationRequests.length} solicitação(ões)</p></div><Link className="btn btn-secondary btn-sm" to={`/ferias?funcionario=${selectedEmp.id}`}>Abrir gestão de férias</Link></div>
            {(() => {
              const today = getTodayInSP();
              const availablePeriod = vacationPeriods.find((period) => today > period.periodo_fim && today <= period.prazo_concessivo);
              const upcomingPeriod = vacationPeriods.find((period) => today <= period.periodo_fim);
              const firstRequestDate = upcomingPeriod ? addIsoDays(upcomingPeriod.periodo_fim, 1) : null;
              const earliestLeaveDate = availablePeriod ? addIsoDays(today, 30) : upcomingPeriod ? addIsoDays(upcomingPeriod.periodo_fim, 31) : null;
              return <div className="vacation-eligibility-overview"><div><span>Data de admissão</span><strong>{selectedEmp.data_admissao ? formatDate(`${selectedEmp.data_admissao}T12:00:00`) : 'Não informada'}</strong></div><div><span>Direito atual</span><strong>{availablePeriod ? `Pode solicitar desde ${formatDate(`${addIsoDays(availablePeriod.periodo_fim, 1)}T12:00:00`)}` : firstRequestDate ? `Solicitações a partir de ${formatDate(`${firstRequestDate}T12:00:00`)}` : 'Sem período disponível'}</strong></div><div><span>Primeiro início de gozo possível</span><strong>{earliestLeaveDate ? formatDate(`${earliestLeaveDate}T12:00:00`) : 'A definir pelo período aquisitivo'}</strong><small>Considerando o prazo mínimo de 30 dias entre o pedido e a saída.</small></div></div>;
            })()}
            {vacationPeriods.length ? <div className="employee-vacation-cycles">{vacationPeriods.map((period) => {
              const request = vacationRequests.find((item) => item.periodo_id === period.id);
              const today = getTodayInSP();
              const eligibleForLeave = today > period.periodo_fim && today <= period.prazo_concessivo;
              const firstRequestDate = addIsoDays(period.periodo_fim, 1);
              const earliestLeaveDate = addIsoDays(period.periodo_fim, 31);
              return <article className="employee-vacation-cycle" key={period.id}><div><strong>Período aquisitivo: {formatDate(`${period.periodo_inicio}T12:00:00`)} – {formatDate(`${period.periodo_fim}T12:00:00`)}</strong><span>Admissão: {selectedEmp.data_admissao ? formatDate(`${selectedEmp.data_admissao}T12:00:00`) : 'Não informada'}</span><span>Elegível para solicitar a partir de: {formatDate(`${firstRequestDate}T12:00:00`)}</span><span>Prazo final para gozo: {formatDate(`${period.prazo_concessivo}T12:00:00`)}</span><span>Abono escolhido: {period.dias_abono ? `${period.dias_abono} dia(s) vendido(s)` : 'Não'}</span>{!eligibleForLeave && today <= period.periodo_fim && <small className="vacation-ineligible-message">Ainda não elegível. Se o pedido for enviado na primeira data disponível, a saída mais cedo será {formatDate(`${earliestLeaveDate}T12:00:00`)}, respeitando a antecedência mínima de 30 dias.</small>}</div>{request ? <div className="employee-vacation-request"><Badge variant={request.status === 'aprovada' ? 'success' : request.status === 'recusada' ? 'danger' : 'warning'}>{request.status === 'aprovada' ? 'Aprovada' : request.status === 'recusada' ? 'Recusada' : 'Pendente'}</Badge><span>Saída: {formatDate(`${request.data_inicio}T12:00:00`)}</span><span>Retorno ao trabalho: {formatDate(`${(request.data_retorno || addIsoDays(request.data_fim, 1))}T12:00:00`)}</span>{request.status === 'recusada' && <small>Justificativa: {request.justificativa_recusa}</small>}<small>{request.email_enviado_em ? `E-mail enviado em ${formatDateTime(request.email_enviado_em)}` : request.email_erro ? `Falha no e-mail: ${request.email_erro}` : request.status !== 'pendente' ? 'E-mail da decisão pendente' : ''}</small></div> : <Badge variant={eligibleForLeave ? 'info' : 'warning'}>{eligibleForLeave ? 'Sem solicitação' : 'Ainda não elegível para gozo'}</Badge>}</article>;
            })}</div> : <p className="employee-no-results">Os períodos de férias serão calculados após informar a data de admissão e abrir a tela de gestão.</p>}
          </section>

          <section className="employee-records-section">
            <div className="employee-section-heading"><div><h3>Registros de ponto</h3><p>{range.start && range.end ? `${formatDate(`${range.start}T12:00:00`)} a ${formatDate(`${range.end}T12:00:00`)}` : 'Escolha um período válido.'}</p></div><div className="employee-export-actions"><button className="btn btn-secondary btn-sm" onClick={downloadEmployeeRecordsExcel} disabled={detailLoading || !records.length || exportingExcel}>{exportingExcel ? 'Gerando Excel…' : 'Baixar Excel'}</button><button className="btn btn-primary btn-sm" onClick={downloadEmployeeRecordsPdf} disabled={detailLoading || !records.length || exportingPdf}>{exportingPdf ? 'Gerando PDF…' : 'Baixar PDF'}</button></div></div>
          <div className="employee-record-filters">
              <div className="filter-chips">{FILTERS.map((item) => <button key={item.id} className={`filter-chip ${filter === item.id ? 'active' : ''}`} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
              {filter === 'day' && <label className="employee-date-filter">Dia<input className="form-input" type="date" value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} /></label>}
              {(filter === 'week' || filter === 'month') && <label className="employee-date-filter">Referência<input className="form-input" type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} /></label>}
              {filter === 'custom' && <div className="employee-custom-range"><label className="employee-date-filter">De<input className="form-input" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label className="employee-date-filter">Até<input className="form-input" type="date" min={customStart} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
            </div>
            {detailLoading ? <div className="flex flex-center" style={{ minHeight: '160px' }}><Spinner /></div> : records.length ? (
              <>
                {editingPunchId && <form className="employee-punch-edit-form" onSubmit={savePunchEdit}>
                  <div><h4>Ajustar horários do ponto</h4><p>Este registro pode ser ajustado somente até 96 horas após sua criação. O prazo é validado pelo sistema.</p></div>
                  <div className="employee-punch-edit-fields">
                    <label className="form-group">Entrada<input className="form-input" required type="time" value={punchEditForm.entrada} onChange={(event) => setPunchEditForm((current) => ({ ...current, entrada: event.target.value }))} /></label>
                    <label className="form-group">Saída para almoço<input className="form-input" type="time" value={punchEditForm.saida_almoco} onChange={(event) => setPunchEditForm((current) => ({ ...current, saida_almoco: event.target.value }))} /></label>
                    <label className="form-group">Retorno do almoço<input className="form-input" type="time" value={punchEditForm.retorno_almoco} onChange={(event) => setPunchEditForm((current) => ({ ...current, retorno_almoco: event.target.value }))} /></label>
                    <label className="form-group">Saída<input className="form-input" type="time" value={punchEditForm.saida} onChange={(event) => setPunchEditForm((current) => ({ ...current, saida: event.target.value }))} /></label>
                    {punchEditForm.saida && <label className="form-group">Data da saída<input className="form-input" required type="date" min={records.find((record) => record.id === editingPunchId)?.data} max={addIsoDays(records.find((record) => record.id === editingPunchId)?.data || '', 1)} value={punchEditForm.saida_data} onChange={(event) => setPunchEditForm((current) => ({ ...current, saida_data: event.target.value }))} /></label>}
                  </div>
                  <div className="employee-punch-edit-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingPunchId(null)} disabled={savingPunch}>Cancelar</button><button className="btn btn-primary btn-sm" disabled={savingPunch}>{savingPunch ? 'Salvando…' : 'Salvar horários'}</button></div>
                </form>}
                <div className="table-container"><table className="table"><thead><tr><th>Data</th><th>Entrada</th><th>Turno do dia</th><th>Saída almoço</th><th>Retorno almoço</th><th>Saída</th><th>Total</th><th>Previsto</th><th>Saldo</th><th>Status</th><th>Ajuste</th></tr></thead><tbody>{records.map((record) => { const comparison = getScheduleComparison(record, selectedEmp.escala_trabalho); const editable = canEditPunch(record); return <tr key={record.id}><td>{formatDate(`${record.data}T12:00:00`)}</td><td>{formatTime(record.entrada)}</td><td>{getShiftLabel(record.turno_trabalhado || inferShiftFromEntry(record.entrada))}</td><td>{formatTime(record.saida_almoco)}</td><td>{formatTime(record.retorno_almoco)}</td><td>{formatTime(record.saida)}{record.saida_data && record.saida_data !== record.data ? ` (${formatDate(`${record.saida_data}T12:00:00`)})` : ''}</td><td><strong>{calcDailyTotal(record)}</strong></td><td>{comparison.expected}</td><td>{comparison.balance}</td><td><Badge variant={record.saida ? 'success' : 'warning'}>{record.saida ? 'Completo' : 'Incompleto'}</Badge></td><td>{editable ? <button className="btn btn-secondary btn-sm" onClick={() => startPunchEdit(record)} disabled={savingPunch}>Editar horários</button> : <span className="employee-punch-locked" title="Prazo de 96 horas após a criação encerrado">Prazo encerrado</span>}</td></tr>; })}</tbody></table></div>
              </>
            ) : <p className="employee-no-results">Nenhum registro de ponto neste período.</p>}
          </section>

          <section className="employee-documents-section">
            <div className="employee-section-heading"><div><h3>Documentos enviados</h3><p>{documents.length} documento{documents.length === 1 ? '' : 's'}</p></div></div>
            {documents.length ? <div className="employee-document-list">{documents.map((document) => <article className="employee-document-item" key={document.id}><div className="employee-document-copy"><strong>{document.nome_arquivo}</strong><span>Enviado em {formatDateTime(document.created_at)}</span>{document.periodo_inicio && <small>Período: {formatDate(`${document.periodo_inicio}T12:00:00`)} a {formatDate(`${(document.periodo_fim || document.periodo_inicio)}T12:00:00`)}</small>}</div><Badge variant={document.tipo === 'atestado' ? 'warning' : 'info'}>{document.tipo}</Badge><button className="btn btn-secondary btn-sm" onClick={() => downloadDocument(document)} disabled={downloadingDocument === document.id}>{downloadingDocument === document.id ? 'Baixando…' : 'Baixar'}</button></article>)}</div> : <p className="employee-no-results">Este funcionário ainda não enviou documentos.</p>}
          </section>
        </>
      )}

      <ConfirmDialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} onConfirm={confirmAction} title="Confirmar ação" message={actionType === 'toggle_status' ? `Deseja realmente ${actionEmployee?.ativo ? 'desativar' : 'ativar'} o acesso de ${actionEmployee?.nome}?` : `Deseja alterar o perfil de ${actionEmployee?.nome} para ${actionEmployee?.role === 'admin' ? 'Funcionário' : 'Administrador'}?`} confirmText="Confirmar" danger={actionType === 'toggle_status' && actionEmployee?.ativo} />
    </div>
  );
}
