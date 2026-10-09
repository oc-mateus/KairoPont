import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import {
  formatTime, formatDate, calcDailyTotal,
  getTodayInSP, getCurrentWeekRange, getCurrentMonthRange,
} from '../lib/utils';
import { Spinner, EmptyState, Badge, Tabs } from '../components/ui';
import { addKairoPdfHeader } from '../lib/pdfBranding';
import { downloadTimesheetXlsx } from '../lib/exportTimesheetXlsx';
import { getShiftLabel, inferShiftForRecord, summarizeWorkedShifts } from '../lib/workShifts';

export default function HistoryPage() {
  const { profile } = useAuth();
  const shiftFor = (record) => getShiftLabel(inferShiftForRecord(record, profile?.escala_trabalho?.turno_id));
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

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
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      if (!start || !end) {
        setRecords([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('registros_ponto')
        .select('*')
        .eq('funcionario_id', profile.id)
        .gte('data', start)
        .lte('data', end)
        .order('data', { ascending: false });

      if (error) throw error;
      setRecords(data || []);
    } catch (err) {
      toast.error('Erro ao carregar histórico: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, getDateRange]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);

      const doc = new jsPDF({ orientation: 'landscape' });
      const shiftSummary = summarizeWorkedShifts(records);

      const { start, end } = getDateRange();
      const tableStartY = await addKairoPdfHeader(doc, {
        title: `Relatório de Ponto - ${profile.nome}`,
        details: [
          `Período: ${formatDate(start + 'T00:00:00')} a ${formatDate(end + 'T00:00:00')}`,
          `Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        ],
      });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text(`Turnos trabalhados no período (${records.length} ${records.length === 1 ? 'registro' : 'registros'})`, 14, tableStartY + 2);
      autoTable(doc, {
        startY: tableStartY + 4,
        head: [['1º turno', '2º turno', '3º turno', 'Sem turno identificado']],
        body: [[shiftSummary.turno1, shiftSummary.turno2, shiftSummary.turno3, shiftSummary.unidentified].map((count) => `${count} dia${count === 1 ? '' : 's'}`)],
        theme: 'grid',
        headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
        bodyStyles: { fontSize: 8, halign: 'center' },
        styles: { cellPadding: 2.5 },
      });

      // Table
      const tableData = records.map(r => [
        formatDate(r.data + 'T00:00:00'),
        formatTime(r.entrada),
        shiftFor(r),
        formatTime(r.saida_almoco),
        formatTime(r.retorno_almoco),
        `${formatTime(r.saida)}${r.saida_data && r.saida_data !== r.data ? ` (${formatDate(r.saida_data + 'T12:00:00')})` : ''}`,
        calcDailyTotal(r),
        r.saida ? 'Completo' : 'Incompleto',
      ]);

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 5,
        head: [['Data', 'Entrada', 'Turno', 'Saída Almoço', 'Retorno', 'Saída', 'Horas computadas', 'Status']],
        body: tableData,
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
      });

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
        calcDailyTotal,
        extraColumns: [
          { key: 'shift', header: 'Turno trabalhado', width: 20, value: shiftFor },
          { key: 'exitDate', header: 'Data da saída', width: 17, value: (record) => record.saida_data && record.saida_data !== record.data ? formatDate(`${record.saida_data}T12:00:00`) : 'Mesmo dia' },
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
      md += `**Período:** ${formatDate(start + 'T00:00:00')} a ${formatDate(end + 'T00:00:00')}\n`;
      md += `**Gerado em:** ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n`;
      md += `| Data | Entrada | Turno | Saída Almoço | Retorno | Saída | Horas computadas | Status |\n`;
      md += `|------|---------|-------|-------------|---------|-------|-------|--------|\n`;

      records.forEach(r => {
        md += `| ${formatDate(r.data + 'T00:00:00')} | ${formatTime(r.entrada)} | ${shiftFor(r)} | ${formatTime(r.saida_almoco)} | ${formatTime(r.retorno_almoco)} | ${formatTime(r.saida)}${r.saida_data && r.saida_data !== r.data ? ` (${formatDate(r.saida_data + 'T12:00:00')})` : ''} | ${calcDailyTotal(r)} | ${r.saida ? '✅ Completo' : '⚠️ Incompleto'} |\n`;
      });

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
      md += `**Período:** ${formatDate(start + 'T00:00:00')} a ${formatDate(end + 'T00:00:00')}\n\n`;
      md += `| Data | Entrada | Turno | Saída Almoço | Retorno | Saída | Horas computadas | Status |\n`;
      md += `|---|---|---|---|---|---|---|---|\n`;

      records.forEach(r => {
        md += `| ${formatDate(r.data + 'T00:00:00')} | ${formatTime(r.entrada)} | ${shiftFor(r)} | ${formatTime(r.saida_almoco)} | ${formatTime(r.retorno_almoco)} | ${formatTime(r.saida)}${r.saida_data && r.saida_data !== r.data ? ` (${formatDate(r.saida_data + 'T12:00:00')})` : ''} | ${calcDailyTotal(r)} | ${r.saida ? '✅ Completo' : '⚠️ Incompleto'} |\n`;
      });

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
          <p className="page-subtitle">Consulte seus registros de ponto</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleExportExcel} disabled={records.length === 0 || exportingExcel}>
            {exportingExcel ? <Spinner /> : '📊 Excel'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportMarkdown} disabled={records.length === 0}>
            📝 Markdown
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleExportPDF} disabled={records.length === 0 || exporting}>
            {exporting ? <Spinner /> : '📄 PDF'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleSendToNotion} disabled={records.length === 0}>
            📓 Notion
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
              onChange={e => setCustomStart(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label>Data final</label>
            <input
              type="date"
              className="form-input"
              value={customEnd}
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
                  <th>Entrada</th>
                  <th>Turno do dia</th>
                  <th>Saída Almoço</th>
                  <th>Retorno</th>
                  <th>Saída</th>
                  <th>Horas computadas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td>{formatDate(r.data + 'T00:00:00')}</td>
                    <td>{formatTime(r.entrada)}</td>
                    <td>{shiftFor(r)}</td>
                    <td>{formatTime(r.saida_almoco)}</td>
                    <td>{formatTime(r.retorno_almoco)}</td>
                    <td>{formatTime(r.saida)}{r.saida_data && r.saida_data !== r.data ? ` (${formatDate(r.saida_data + 'T12:00:00')})` : ''}</td>
                    <td><strong>{calcDailyTotal(r)}</strong></td>
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
                  <span className="table-card-value">{formatDate(r.data + 'T00:00:00')}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Entrada</span>
                  <span className="table-card-value">{formatTime(r.entrada)}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Turno do dia</span>
                  <span className="table-card-value">{shiftFor(r)}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Saída Almoço</span>
                  <span className="table-card-value">{formatTime(r.saida_almoco)}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Retorno</span>
                  <span className="table-card-value">{formatTime(r.retorno_almoco)}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Saída</span>
                  <span className="table-card-value">{formatTime(r.saida)}{r.saida_data && r.saida_data !== r.data ? ` (${formatDate(r.saida_data + 'T12:00:00')})` : ''}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Horas computadas</span>
                  <span className="table-card-value"><strong>{calcDailyTotal(r)}</strong></span>
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
