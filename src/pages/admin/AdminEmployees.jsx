import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { calcDailyTotal, formatCPF, formatDate, formatDateTime, formatTime, getTodayInSP, maskCPF } from '../../lib/utils';
import { Spinner, Badge, Avatar, ConfirmDialog } from '../../components/ui';
import { addKairoPdfHeader } from '../../lib/pdfBranding';
import { downloadTimesheetXlsx } from '../../lib/exportTimesheetXlsx';
import WorkScheduleCard from '../../components/WorkScheduleCard';

const FILTERS = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
  { id: 'custom', label: 'Período personalizado' },
];

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
  const entry = timeMinutes(schedule.entrada);
  const lunchOut = timeMinutes(schedule.saida_almoco);
  const lunchIn = timeMinutes(schedule.retorno_almoco);
  const exit = timeMinutes(schedule.saida);
  const expectedMinutes = entry != null && lunchOut != null && lunchIn != null && exit != null ? (lunchOut - entry) + (exit - lunchIn) : null;
  const actualEntry = timeMinutes(record.entrada);
  const actualLunchOut = timeMinutes(record.saida_almoco);
  const actualLunchIn = timeMinutes(record.retorno_almoco);
  const actualExit = timeMinutes(record.saida);
  const actualMinutes = actualEntry != null && actualLunchOut != null && actualLunchIn != null && actualExit != null ? (actualLunchOut - actualEntry) + (actualExit - actualLunchIn) : null;
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
  const [documents, setDocuments] = useState([]);
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
  const [employeeForm, setEmployeeForm] = useState({ nome: '', email: '', cpf: '', cargo: '', data_admissao: getTodayInSP(), tipo: '5x2', dias_semana: [1, 2, 3, 4, 5], entrada: '08:00', saida_almoco: '12:00', retorno_almoco: '13:00', saida: '17:00' });

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
    if (selectedEmp) setEmployeeForm(formFromEmployee(selectedEmp));
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

  const scheduleFromForm = (form) => ({
    tipo: form.tipo,
    dias_semana: form.dias_semana,
    entrada: form.entrada,
    saida_almoco: form.saida_almoco,
    retorno_almoco: form.retorno_almoco,
    saida: form.saida,
  });

  const formFromEmployee = (employee) => {
    const schedule = employee.escala_trabalho || {};
    return {
      nome: employee.nome || '', email: employee.email || '', cpf: formatCPF(employee.cpf) || '', cargo: employee.cargo || '',
      data_admissao: employee.data_admissao || '', tipo: schedule.tipo || '5x2', dias_semana: schedule.dias_semana || [1, 2, 3, 4, 5],
      entrada: schedule.entrada || '08:00', saida_almoco: schedule.saida_almoco || '12:00', retorno_almoco: schedule.retorno_almoco || '13:00', saida: schedule.saida || '17:00',
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
      setEmployeeForm({ nome: '', email: '', cpf: '', cargo: '', data_admissao: getTodayInSP(), tipo: '5x2', dias_semana: [1, 2, 3, 4, 5], entrada: '08:00', saida_almoco: '12:00', retorno_almoco: '13:00', saida: '17:00' });
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
      toast.success('Data de admissão e escala atualizadas.');
      await fetchEmployees();
      const { data } = await supabase.from('funcionarios').select('*').eq('id', selectedEmp.id).maybeSingle();
      if (data) setSelectedEmp(data);
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
      <div className="form-row"><label className="form-group">Data de admissão<input className="form-input" required type="date" max={getTodayInSP()} value={employeeForm.data_admissao} onChange={(event) => setFormField('data_admissao', event.target.value)} /></label><label className="form-group">Escala<select className="form-input" value={employeeForm.tipo} onChange={(event) => setFormField('tipo', event.target.value)}><option value="5x2">5x2</option><option value="6x1">6x1</option><option value="personalizada">Personalizada</option></select></label></div>
      <fieldset className="employee-weekdays"><legend>Dias de trabalho</legend>{['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day, index) => <label key={day}><input type="checkbox" checked={employeeForm.dias_semana.includes(index + 1)} onChange={(event) => setFormField('dias_semana', event.target.checked ? [...employeeForm.dias_semana, index + 1].sort() : employeeForm.dias_semana.filter((value) => value !== index + 1))} />{day}</label>)}</fieldset>
      <div className="form-row employee-schedule-times">{[['entrada', 'Entrada'], ['saida_almoco', 'Saída almoço'], ['retorno_almoco', 'Retorno'], ['saida', 'Saída']].map(([field, label]) => <label className="form-group" key={field}>{label}<input className="form-input" type="time" required value={employeeForm[field]} onChange={(event) => setFormField(field, event.target.value)} /></label>)}</div>
      <button className="btn btn-primary" disabled={savingEmployment || employeeForm.dias_semana.length === 0}>{savingEmployment ? 'Salvando…' : submitLabel}</button>
    </form>
  );

  const range = useMemo(() => getRange(filter, selectedDay, customStart, customEnd, referenceDate), [filter, selectedDay, customStart, customEnd, referenceDate]);

  useEffect(() => {
    let cancelled = false;
    async function fetchEmployeeDetails() {
      if (!selectedEmp) {
        setRecords([]);
        setDocuments([]);
        return;
      }
      const hasValidRange = Boolean(range.start && range.end && range.start <= range.end);
      setRecords([]);
      setDocuments([]);
      setDetailLoading(true);
      try {
        const [employeeRecords, employeeDocuments] = await Promise.all([
          hasValidRange ? fetchAllRows(() => supabase.from('registros_ponto').select('*').eq('funcionario_id', selectedEmp.id).gte('data', range.start).lte('data', range.end).order('data', { ascending: false })) : Promise.resolve([]),
          fetchAllRows(() => supabase.from('documentos').select('*').eq('funcionario_id', selectedEmp.id).order('created_at', { ascending: false })),
        ]);
        if (!cancelled) {
          setRecords(employeeRecords);
          setDocuments(employeeDocuments);
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
      const pdf = new jsPDF();
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
        head: [['Data', 'Entrada', 'Saída almoço', 'Retorno', 'Saída', 'Total', 'Previsto', 'Saldo', 'Status']],
        body: records.map((record) => [
          formatDate(`${record.data}T12:00:00`), formatTime(record.entrada), formatTime(record.saida_almoco),
          formatTime(record.retorno_almoco), formatTime(record.saida), calcDailyTotal(record), getScheduleComparison(record, selectedEmp.escala_trabalho).expected,
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
          <div className="flex justify-between gap-3 employee-list-toolbar"><p className="page-subtitle">Contas novas só podem ser criadas por um administrador.</p><button className="btn btn-primary" onClick={() => setShowInviteForm((value) => !value)}>{showInviteForm ? 'Cancelar' : 'Novo funcionário'}</button></div>
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
              <div><span>Escala de trabalho</span><strong>{selectedEmp.escala_trabalho ? `${selectedEmp.escala_trabalho.tipo} · ${selectedEmp.escala_trabalho.entrada}–${selectedEmp.escala_trabalho.saida}` : 'Não informada'}</strong></div>
            </div>
          </section>

          <section className="employee-records-section"><h3>Admissão e escala semanal</h3><p className="page-subtitle">Usadas para liberar férias e comparar o previsto com as marcações de ponto.</p>{employmentForm(saveEmployment, 'Salvar dados trabalhistas')}</section>
          <WorkScheduleCard schedule={selectedEmp.escala_trabalho} admissionDate={selectedEmp.data_admissao} />

          <section className="employee-records-section">
            <div className="employee-section-heading"><div><h3>Registros de ponto</h3><p>{range.start && range.end ? `${formatDate(`${range.start}T12:00:00`)} a ${formatDate(`${range.end}T12:00:00`)}` : 'Escolha um período válido.'}</p></div><div className="employee-export-actions"><button className="btn btn-secondary btn-sm" onClick={downloadEmployeeRecordsExcel} disabled={detailLoading || !records.length || exportingExcel}>{exportingExcel ? 'Gerando Excel…' : 'Baixar Excel'}</button><button className="btn btn-primary btn-sm" onClick={downloadEmployeeRecordsPdf} disabled={detailLoading || !records.length || exportingPdf}>{exportingPdf ? 'Gerando PDF…' : 'Baixar PDF'}</button></div></div>
          <div className="employee-record-filters">
              <div className="filter-chips">{FILTERS.map((item) => <button key={item.id} className={`filter-chip ${filter === item.id ? 'active' : ''}`} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
              {filter === 'day' && <label className="employee-date-filter">Dia<input className="form-input" type="date" value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} /></label>}
              {(filter === 'week' || filter === 'month') && <label className="employee-date-filter">Referência<input className="form-input" type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} /></label>}
              {filter === 'custom' && <div className="employee-custom-range"><label className="employee-date-filter">De<input className="form-input" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label className="employee-date-filter">Até<input className="form-input" type="date" min={customStart} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
            </div>
            {detailLoading ? <div className="flex flex-center" style={{ minHeight: '160px' }}><Spinner /></div> : records.length ? (
              <div className="table-container"><table className="table"><thead><tr><th>Data</th><th>Entrada</th><th>Saída almoço</th><th>Retorno almoço</th><th>Saída</th><th>Total</th><th>Previsto</th><th>Saldo</th><th>Status</th></tr></thead><tbody>{records.map((record) => { const comparison = getScheduleComparison(record, selectedEmp.escala_trabalho); return <tr key={record.id}><td>{formatDate(`${record.data}T12:00:00`)}</td><td>{formatTime(record.entrada)}</td><td>{formatTime(record.saida_almoco)}</td><td>{formatTime(record.retorno_almoco)}</td><td>{formatTime(record.saida)}</td><td><strong>{calcDailyTotal(record)}</strong></td><td>{comparison.expected}</td><td>{comparison.balance}</td><td><Badge variant={record.saida ? 'success' : 'warning'}>{record.saida ? 'Completo' : 'Incompleto'}</Badge></td></tr>; })}</tbody></table></div>
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
