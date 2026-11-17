import { useState, useEffect, useCallback, useRef } from 'react';
import LoadError from '../components/LoadError';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { fetchTimesheetReport, fetchTimesheetRows, supabase } from '../lib/supabase';
import {
  formatTime, formatDate, formatPunchExitDate, calcDailyTotal, calcElapsedDailyTotal, getElapsedWorkMinutes, formatMinutesAsHours,
  getOvertimeMinutes, getPunchContract, getTodayInSP, getCurrentWeekRange, getCurrentMonthRange,
  isValidDateRange,
} from '../lib/utils';
import { Spinner, EmptyState, Badge, Tabs } from '../components/ui';
import { addKairoPdfHeader, addPjSignatureFields } from '../lib/pdfBranding';
import { getPjTimesheetSnapshot, pjPdfHoursDetails } from '../lib/pjTimesheet';
import { downloadTimesheetXlsx } from '../lib/exportTimesheetXlsx';
import { getLunchLabelForRecord, getRegisteredScheduleLabel, getShiftLabel, inferShiftForRecord, summarizeWorkedShifts } from '../lib/workShifts';

function ExportIcon({ kind }) {
  const icons = {
    excel: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
    markdown: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13v4m0-4 2 2 2-2v4m3-4v4m0-4 2 2" /></>,
    pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M12 12v6m-3-3 3 3 3-3" /></>,
    notion: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 17V7l8 10V7" /></>,
  };

  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[kind]}</svg>;
}

function timesheetColumns(hasClt, mixedContracts) {
  return ['Data', ...(mixedContracts ? ['Vínculo'] : []), ...(hasClt ? ['Horário'] : []),
    'Entrada', ...(hasClt ? ['Intervalo de almoço'] : []), 'Saída', 'Horas computadas', 'Status'];
}

export default function HistoryPage() {
  const { profile } = useAuth();
  const contractFor = (record) => getPunchContract(record, profile?.tipo_contrato);
  const recordIsPj = (record) => contractFor(record) === 'pj';
  const dailyTotal = (record) => recordIsPj(record) ? calcElapsedDailyTotal(record) : calcDailyTotal(record);
  const shiftIdFor = (record) => inferShiftForRecord(record, profile?.escala_trabalho?.turno_id);
  const shiftFor = (record) => recordIsPj(record) ? '—' : getShiftLabel(shiftIdFor(record));
  const lunchFor = (record) => recordIsPj(record) ? '—' : getLunchLabelForRecord(record, shiftIdFor(record));
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const latestRequest = useRef(0);
  const [filter, setFilter] = useState('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const pjRecords = records.filter(recordIsPj);
  const cltRecords = records.filter((record) => !recordIsPj(record));
  const hasClt = records.length ? cltRecords.length > 0 : profile?.tipo_contrato !== 'pj';
  const mixedContracts = hasClt && pjRecords.length > 0;
  const periodContract = mixedContracts ? 'CLT e PJ' : hasClt ? 'CLT' : 'PJ';
  const pjPeriodMinutes = pjRecords.reduce((total, record) => total + getElapsedWorkMinutes(record), 0);
  const showHabitualSchedule = hasClt && profile?.tipo_contrato === 'clt' && profile.escala_trabalho;

  const reportColumns = timesheetColumns(hasClt, mixedContracts);
  const reportCells = (record, clt = hasClt, mixed = mixedContracts, pjRow) => [
    formatDate(record.data),
    ...(mixed ? [contractFor(record).toUpperCase()] : []),
    ...(clt ? [shiftFor(record)] : []),
    formatTime(record.entrada),
    ...(clt ? [lunchFor(record)] : []),
    pjRow?.hideExit ? '—' : `${formatTime(record.saida)}${record.saida_data && record.saida_data !== record.data ? ` (${formatDate(record.saida_data)})` : ''}`,
    pjRow?.hours ?? dailyTotal(record),
    pjRow?.status ?? (record.saida ? 'Completo' : 'Incompleto'),
  ];
  const markdownTable = () => [reportColumns, reportColumns.map(() => '---'), ...records.map((record) => reportCells(record))]
    .map((cells) => `| ${cells.join(' | ')} |`).join('\n');

  const getDateRange = useCallback(() => {
    switch (filter) {
      case 'today':
        const today = getTodayInSP();
        return { start: today, end: today };
      case 'week':
        return getCurrentWeekRange();
      case 'month':
        return getCurrentMonthRange();
      case 'custom':
        return { start: customStart, end: customEnd };
      default:
        return getCurrentWeekRange();
    }
  }, [filter, customStart, customEnd]);

  const fetchRecords = useCallback(async () => {
    if (!profile?.id) return;
    const requestId = ++latestRequest.current;
    setLoading(true);
    setLoadError(false);
    setRecords([]);
    try {
      const { start, end } = getDateRange();
      if (!start || !end) {
        setRecords([]);
        setLoading(false);
        return;
      }
      if (filter === 'custom' && !isValidDateRange(start, end)) {
        setRecords([]);
        toast.error('Confira o intervalo: a data inicial deve ser válida e anterior ou igual à data final.');
        return;
      }

      const data = await fetchTimesheetRows(profile.id, start, end);
      if (requestId !== latestRequest.current) return;
      setRecords(data || []);
    } catch (err) {
      if (requestId === latestRequest.current) setLoadError(true);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [profile?.id, getDateRange]);

  useEffect(() => {
    fetchRecords();
    return () => { latestRequest.current += 1; };
  }, [fetchRecords]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { start, end } = getDateRange();
      const [{ jsPDF }, { autoTable }, { records: pdfRecords, downloadedAt }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        fetchTimesheetReport(profile.id, start, end),
      ]);
      if (!pdfRecords.length) throw new Error('Não há registros para baixar neste período.');
      const pdfCltRecords = pdfRecords.filter((record) => !recordIsPj(record));
      const pdfPjRecords = pdfRecords.filter(recordIsPj);
      const hasPdfClt = pdfCltRecords.length > 0;
      const hasPdfPj = pdfPjRecords.length > 0;
      const pdfMixed = hasPdfClt && hasPdfPj;
      const holidays = hasPdfClt
        ? await supabase.rpc('list_punch_holiday_dates', { p_start: start, p_end: end }) : { data: [] };
      if (holidays.error) throw holidays.error;

      const doc = new jsPDF({ orientation: 'landscape' });
      const pjSnapshot = getPjTimesheetSnapshot(pdfRecords, downloadedAt, profile.tipo_contrato);
      const shiftSummary = summarizeWorkedShifts(pdfCltRecords);
      const holidayDates = new Set((holidays.data || []).map(({ data }) => data));
      const overtime = pdfCltRecords.map((record) => getOvertimeMinutes(record, shiftIdFor(record), holidayDates.has(record.data)));
      const overtimeMinutes = overtime.reduce((total, minutes) => total + minutes, 0);
      const overtimeDays = overtime.filter((minutes) => minutes > 0).length;

      const tableStartY = await addKairoPdfHeader(doc, {
        title: `Relatório de Ponto - ${profile.nome}`,
        details: [
          `Vínculo no período: ${pdfMixed ? 'CLT e PJ' : hasPdfClt ? 'CLT' : 'PJ'}`,
          ...(hasPdfClt && profile.tipo_contrato === 'clt' && profile.escala_trabalho ? [`Horários habituais atuais: ${getRegisteredScheduleLabel(profile.escala_trabalho)}`] : []),
          ...(hasPdfClt ? ['Sábados: 4h previstas, sem intervalo fixo'] : []),
          ...(hasPdfPj ? pjPdfHoursDetails(pjSnapshot) : []),
          `Período: ${formatDate(start + 'T00:00:00')} a ${formatDate(end + 'T00:00:00')}`,
          `Gerado em: ${downloadedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (São Paulo)`,
        ],
      });

      let tableStart = tableStartY;
      if (hasPdfClt) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        doc.text(`Horários CLT registrados no período (${pdfCltRecords.length})`, 14, tableStartY + 2);
        autoTable(doc, {
          startY: tableStartY + 4,
          head: [['06:00–15:00', '08:00–17:00', '14:00–22:52', 'Sem horário identificado']],
          body: [[shiftSummary.turno1, shiftSummary.turno2, shiftSummary.turno3, shiftSummary.unidentified].map((count) => `${count} dia${count === 1 ? '' : 's'}`)],
          theme: 'grid',
          headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
          bodyStyles: { fontSize: 8, halign: 'center' },
          styles: { cellPadding: 2.5 },
        });
        tableStart = doc.lastAutoTable.finalY + 5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        doc.text('Resumo de horas extras', 14, tableStart + 2);
        autoTable(doc, {
          startY: tableStart + 4,
          head: [['Total de horas extras', 'Dias com horas extras']],
          body: [[formatMinutesAsHours(overtimeMinutes), String(overtimeDays)]],
          theme: 'grid',
          headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
          bodyStyles: { fontSize: 8, halign: 'center' },
          styles: { cellPadding: 2.5 },
        });
        tableStart = doc.lastAutoTable.finalY + 5;
      }

      autoTable(doc, {
        startY: tableStart,
        head: [timesheetColumns(hasPdfClt, pdfMixed)],
        body: pdfRecords.map((record) => reportCells(record, hasPdfClt, pdfMixed, pjSnapshot.rows.get(record))),
        theme: 'grid',
        headStyles: {
          fillColor: [27, 94, 32],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 8,
        },
        alternateRowStyles: {
          fillColor: [232, 245, 233],
        },
        styles: {
          cellPadding: 3,
        },
        margin: { bottom: 20 },
      });

      if (hasPdfPj) addPjSignatureFields(doc, doc.lastAutoTable.finalY);

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          `Página ${i} de ${pageCount} - KairoPont © ${new Date().getFullYear()} Kairo Automações`,
          14,
          doc.internal.pageSize.height - 10
        );
      }

      doc.save(`ponto_${profile.nome.replace(/\s+/g, '_')}_${start}_${end}.pdf`);
      toast.success('PDF exportado com sucesso!');
    } catch (err) {
      toast.error('Erro ao exportar PDF: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const { start, end } = getDateRange();
      await downloadTimesheetXlsx({
        records,
        title: `Histórico de ponto - ${profile.nome}`,
        period: `Período: ${formatDate(`${start}T12:00:00`)} a ${formatDate(`${end}T12:00:00`)}`,
        filename: `ponto_${profile.nome.replace(/\s+/g, '_')}_${start}_${end}.xlsx`,
        calcDailyTotal: dailyTotal,
        lunchLabel: lunchFor,
        scheduleColumn: hasClt ? { key: 'shift', header: 'Horário', width: 20, value: shiftFor } : null,
        summary: pjRecords.length ? { label: 'Total de horas PJ', value: formatMinutesAsHours(pjPeriodMinutes) } : null,
        extraColumns: [
          { key: 'contract', header: 'Tipo de vínculo', width: 16, value: (record) => contractFor(record).toUpperCase() },
          { key: 'exitDate', header: 'Data da saída', width: 17, value: formatPunchExitDate },
        ],
      });
      toast.success('Planilha Excel exportada com sucesso!');
    } catch (err) {
      toast.error('Erro ao exportar Excel: ' + err.message);
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportMarkdown = () => {
    try {
      const { start, end } = getDateRange();
      let md = `# Relatório de Ponto\n\n`;
      md += `**Funcionário:** ${profile.nome}\n`;
      md += `**Tipo de vínculo:** ${periodContract}${showHabitualSchedule ? ` · Horários habituais atuais: ${getRegisteredScheduleLabel(profile.escala_trabalho)}` : ''}\n`;
      md += `**Período:** ${formatDate(start + 'T00:00:00')} a ${formatDate(end + 'T00:00:00')}\n`;
      md += `**Gerado em:** ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n`;
      md += markdownTable() + '\n';

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ponto_${profile.nome.replace(/\s+/g, '_')}_${start}_${end}.md`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Markdown exportado! Compatível com importação no Notion.');
    } catch (err) {
      toast.error('Erro ao exportar Markdown: ' + err.message);
    }
  };

  const handleSendToNotion = async () => {
    try {
      const { start, end } = getDateRange();
      let md = `## Relatório de Ponto - ${profile.nome}\n`;
      md += `**Tipo de vínculo:** ${periodContract}${showHabitualSchedule ? ` · Horários habituais atuais: ${getRegisteredScheduleLabel(profile.escala_trabalho)}` : ''}\n`;
      md += `**Período:** ${formatDate(start + 'T00:00:00')} a ${formatDate(end + 'T00:00:00')}\n\n`;
      md += markdownTable() + '\n';

      await navigator.clipboard.writeText(md);
      toast.success('Tabela copiada! Agora é só colar (Ctrl+V) na sua página do Notion.');
    } catch (err) {
      toast.error('Erro ao copiar para o Notion: ' + err.message);
    }
  };

  const filterTabs = [
    { id: 'today', label: 'Hoje' },
    { id: 'week', label: 'Semana' },
    { id: 'month', label: 'Mês' },
    { id: 'custom', label: 'Personalizado' },
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2 className="page-title">Meu Histórico</h2>
          <p className="page-subtitle">Vínculo no período: {periodContract}{showHabitualSchedule ? ` · Horários atuais: ${getRegisteredScheduleLabel(profile.escala_trabalho)}` : ''}</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleExportExcel} disabled={records.length === 0 || exportingExcel}>
            {exportingExcel ? <Spinner /> : <><ExportIcon kind="excel" /> Excel</>}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportMarkdown} disabled={records.length === 0}>
            <ExportIcon kind="markdown" /> Markdown
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleExportPDF} disabled={records.length === 0 || exporting}>
            {exporting ? <Spinner /> : <><ExportIcon kind="pdf" /> PDF</>}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleSendToNotion} disabled={records.length === 0}>
            <ExportIcon kind="notion" /> Notion
          </button>
        </div>
      </div>

      {/* Filters */}
      <Tabs tabs={filterTabs} active={filter} onChange={setFilter} />

      {filter === 'custom' && (
        <div className="filters-bar">
          <div className="filter-group">
            <label>Data inicial</label>
            <input
              type="date"
              className="form-input"
              value={customStart}
              max={customEnd || undefined}
              onChange={e => setCustomStart(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label>Data final</label>
            <input
              type="date"
              className="form-input"
              value={customEnd}
              min={customStart || undefined}
              onChange={e => setCustomEnd(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={fetchRecords}>
            Filtrar
          </button>
        </div>
      )}

      {/* Records table */}
      {loading ? (
        <div className="flex flex-center" style={{ padding: 'var(--space-12)' }}>
          <Spinner size="lg" />
        </div>
      ) : loadError ? (
        <LoadError message="Não foi possível carregar o histórico. Confira sua conexão e tente novamente." onRetry={fetchRecords} />
      ) : records.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Nenhum registro encontrado"
          text="Não há registros de ponto para o período selecionado."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  {mixedContracts && <th>Vínculo</th>}
                  {hasClt && <th>Horário</th>}
                  <th>Entrada</th>
                  {hasClt && <th>Intervalo de almoço</th>}
                  <th>Saída</th>
                  <th>Horas computadas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td>{formatDate(r.data + 'T00:00:00')}</td>
                    {mixedContracts && <td>{contractFor(r).toUpperCase()}</td>}
                    {hasClt && <td>{shiftFor(r)}</td>}
                    <td>{formatTime(r.entrada)}</td>
                    {hasClt && <td>{lunchFor(r)}</td>}
                    <td>{formatTime(r.saida)}{r.saida_data && r.saida_data !== r.data ? ` (${formatDate(r.saida_data + 'T12:00:00')})` : ''}</td>
                    <td><strong>{dailyTotal(r)}</strong></td>
                    <td>
                      <Badge variant={r.saida ? 'success' : 'warning'}>
                        {r.saida ? 'Completo' : 'Incompleto'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="table-cards">
            {records.map(r => (
              <div key={r.id} className="table-card-item">
                <div className="table-card-row">
                  <span className="table-card-label">Data</span>
                  <span className="table-card-value">{formatDate(r.data)}{mixedContracts ? ` · ${contractFor(r).toUpperCase()}` : ''}</span>
                </div>
                {hasClt && <div className="table-card-row">
                  <span className="table-card-label">Horário</span>
                  <span className="table-card-value">{shiftFor(r)}</span>
                </div>}
                <div className="table-card-row">
                  <span className="table-card-label">Entrada</span>
                  <span className="table-card-value">{formatTime(r.entrada)}</span>
                </div>
                {hasClt && <div className="table-card-row">
                  <span className="table-card-label">Intervalo de almoço</span>
                  <span className="table-card-value">{lunchFor(r)}</span>
                </div>}
                <div className="table-card-row">
                  <span className="table-card-label">Saída</span>
                  <span className="table-card-value">{formatTime(r.saida)}{r.saida_data && r.saida_data !== r.data ? ` (${formatDate(r.saida_data + 'T12:00:00')})` : ''}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Horas computadas</span>
                  <span className="table-card-value"><strong>{dailyTotal(r)}</strong></span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Status</span>
                  <span className="table-card-value">
                    <Badge variant={r.saida ? 'success' : 'warning'}>
                      {r.saida ? 'Completo' : 'Incompleto'}
                    </Badge>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="card mt-6" style={{ maxWidth: '400px' }}>
            <h4 className="card-title mb-4">Resumo do Período</h4>
            <div className="table-card-row">
              <span className="table-card-label">Dias registrados</span>
              <span className="table-card-value">{records.length}</span>
            </div>
            {pjRecords.length > 0 && <div className="table-card-row"><span className="table-card-label">Total de horas PJ</span><span className="table-card-value"><strong>{formatMinutesAsHours(pjPeriodMinutes)}</strong></span></div>}
            <div className="table-card-row">
              <span className="table-card-label">Dias completos</span>
              <span className="table-card-value">{records.filter(r => r.saida).length}</span>
            </div>
            <div className="table-card-row">
              <span className="table-card-label">Dias incompletos</span>
              <span className="table-card-value">{records.filter(r => !r.saida).length}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
