import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { calcDailyTotal, formatCPF, formatDate, formatDateTime, formatTime, getTodayInSP } from '../../lib/utils';
import { Spinner, Badge, Avatar, ConfirmDialog } from '../../components/ui';

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

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

  const downloadEmployeeRecords = () => {
    if (!records.length) return toast.error('Não há registros para baixar neste período.');
    const headers = ['Data', 'Entrada', 'Saída almoço', 'Retorno almoço', 'Saída', 'Total trabalhado', 'Status'];
    const rows = records.map((record) => [
      formatDate(`${record.data}T12:00:00`), formatTime(record.entrada), formatTime(record.saida_almoco),
      formatTime(record.retorno_almoco), formatTime(record.saida), calcDailyTotal(record), record.saida ? 'Completo' : 'Incompleto',
    ]);
    downloadCsv(`ponto-${safeFilename(selectedEmp.nome)}-${range.start}-a-${range.end}.csv`, [headers, ...rows]);
  };

  const downloadEmployeeRecordsPdf = async () => {
    if (!records.length) return toast.error('Não há registros para baixar neste período.');
    setExportingPdf(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const pdf = new jsPDF();
      pdf.setFontSize(18);
      pdf.setTextColor(27, 94, 32);
      pdf.text('KairoPont - Kairo Automações', 14, 20);
      pdf.setFontSize(12);
      pdf.setTextColor(80);
      pdf.text(`Relatório de ponto - ${selectedEmp.nome}`, 14, 30);
      pdf.setFontSize(10);
      pdf.text(`CPF: ${formatCPF(selectedEmp.cpf)}`, 14, 37);
      pdf.text(`Período: ${formatDate(`${range.start}T12:00:00`)} a ${formatDate(`${range.end}T12:00:00`)}`, 14, 44);
      pdf.text(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 14, 50);
      autoTable(pdf, {
        startY: 58,
        head: [['Data', 'Entrada', 'Saída almoço', 'Retorno', 'Saída', 'Total', 'Status']],
        body: records.map((record) => [
          formatDate(`${record.data}T12:00:00`), formatTime(record.entrada), formatTime(record.saida_almoco),
          formatTime(record.retorno_almoco), formatTime(record.saida), calcDailyTotal(record),
          record.saida ? 'Completo' : 'Incompleto',
        ]),
        theme: 'grid',
        headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
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
            </div>
          </section>

          <section className="employee-records-section">
            <div className="employee-section-heading"><div><h3>Registros de ponto</h3><p>{range.start && range.end ? `${formatDate(`${range.start}T12:00:00`)} a ${formatDate(`${range.end}T12:00:00`)}` : 'Escolha um período válido.'}</p></div><div className="employee-export-actions"><button className="btn btn-secondary btn-sm" onClick={downloadEmployeeRecords} disabled={detailLoading || !records.length}>Baixar CSV</button><button className="btn btn-primary btn-sm" onClick={downloadEmployeeRecordsPdf} disabled={detailLoading || !records.length || exportingPdf}>{exportingPdf ? 'Gerando PDF…' : 'Baixar PDF'}</button></div></div>
          <div className="employee-record-filters">
              <div className="filter-chips">{FILTERS.map((item) => <button key={item.id} className={`filter-chip ${filter === item.id ? 'active' : ''}`} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
              {filter === 'day' && <label className="employee-date-filter">Dia<input className="form-input" type="date" value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} /></label>}
              {(filter === 'week' || filter === 'month') && <label className="employee-date-filter">Referência<input className="form-input" type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} /></label>}
              {filter === 'custom' && <div className="employee-custom-range"><label className="employee-date-filter">De<input className="form-input" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label className="employee-date-filter">Até<input className="form-input" type="date" min={customStart} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
            </div>
            {detailLoading ? <div className="flex flex-center" style={{ minHeight: '160px' }}><Spinner /></div> : records.length ? (
              <div className="table-container"><table className="table"><thead><tr><th>Data</th><th>Entrada</th><th>Saída almoço</th><th>Retorno almoço</th><th>Saída</th><th>Total</th><th>Status</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{formatDate(`${record.data}T12:00:00`)}</td><td>{formatTime(record.entrada)}</td><td>{formatTime(record.saida_almoco)}</td><td>{formatTime(record.retorno_almoco)}</td><td>{formatTime(record.saida)}</td><td><strong>{calcDailyTotal(record)}</strong></td><td><Badge variant={record.saida ? 'success' : 'warning'}>{record.saida ? 'Completo' : 'Incompleto'}</Badge></td></tr>)}</tbody></table></div>
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
