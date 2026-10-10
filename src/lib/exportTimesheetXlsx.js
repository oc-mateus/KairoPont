const spreadsheetMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function excelDate(dateValue) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) return null;
  // ExcelJS serializes Date objects using local calendar fields. Constructing
  // local midnight prevents a UTC-to-local conversion from shifting the day.
  return new Date(year, month - 1, day);
}

function excelTime(timeValue) {
  if (!timeValue) return '—';
  const match = String(timeValue).match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return timeValue;
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  const seconds = (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + fraction;
  return seconds / 86400;
}

export async function downloadTimesheetXlsx({ records, title, period, filename, calcDailyTotal, lunchLabel = null, extraColumns = [], summary = null }) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kairo Automações';
  workbook.title = title;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Registros de ponto', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [
    { key: 'date', width: 16 },
    { key: 'entry', width: 17 },
    { key: 'lunch', width: 25 },
    { key: 'exit', width: 17 },
    { key: 'total', width: 20 },
    { key: 'status', width: 16 },
    ...extraColumns.map((column) => ({ key: column.key, width: column.width || 17 })),
  ];
  const baseColumnCount = 6;
  const finalColumn = String.fromCharCode(64 + baseColumnCount + extraColumns.length);

  sheet.mergeCells(`A1:${finalColumn}1`);
  sheet.getCell('A1').value = title;
  sheet.getRow(1).height = 34;
  sheet.getRow(1).font = { name: 'Aptos Display', size: 17, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D27' } };

  sheet.mergeCells(`A2:${finalColumn}2`);
  sheet.getCell('A2').value = period;
  sheet.getRow(2).height = 24;
  sheet.getRow(2).font = { name: 'Aptos', size: 10, color: { argb: 'FF355542' } };
  sheet.getRow(2).alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3EC' } };

  sheet.mergeCells(`A3:${finalColumn}3`);
  sheet.getCell('A3').value = `Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  sheet.getRow(3).height = 22;
  sheet.getRow(3).font = { name: 'Aptos', size: 9, color: { argb: 'FF66746B' }, italic: true };
  sheet.getRow(3).alignment = { vertical: 'middle', indent: 1 };

  const headers = ['Data', 'Entrada', 'Almoço fixo', 'Saída', 'Horas computadas', 'Status', ...extraColumns.map((column) => column.header)];
  const header = sheet.addRow(headers);
  header.height = 26;
  header.eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF218447' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFC22D2A' } } };
  });

  records.forEach((record, index) => {
    const row = sheet.addRow([
      excelDate(record.data),
      excelTime(record.entrada),
      lunchLabel ? lunchLabel(record) : (record.saida_almoco && record.retorno_almoco ? `${excelTime(record.saida_almoco)}–${excelTime(record.retorno_almoco)}` : '—'),
      excelTime(record.saida),
      calcDailyTotal(record),
      record.saida ? 'Completo' : 'Incompleto',
      ...extraColumns.map((column) => column.value(record)),
    ]);
    row.height = 23;
    row.eachCell((cell) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF26352B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE5DE' } } };
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8F5' } };
      }
    });
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    [2, 4].forEach((column) => { row.getCell(column).numFmt = 'hh:mm:ss'; });
    row.getCell(5).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    const statusCell = row.getCell(6);
    statusCell.font = {
      name: 'Aptos',
      size: 10,
      bold: true,
      color: { argb: record.saida ? 'FF17613A' : 'FFA45D12' },
    };
    statusCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: record.saida ? 'FFE7F4EA' : 'FFFFF3DD' },
    };
  });

  if (summary) {
    const summaryRow = sheet.addRow([]);
    summaryRow.height = 28;
    summaryRow.getCell(1).value = summary.label;
    summaryRow.getCell(1).font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF123D27' } };
    summaryRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    summaryRow.getCell(5).value = summary.value;
    summaryRow.getCell(5).font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FF123D27' } };
    summaryRow.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };
    summaryRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F4EA' } };
      cell.border = { top: { style: 'medium', color: { argb: 'FF218447' } } };
    });
  }

  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + records.length, column: baseColumnCount + extraColumns.length } };
  const buffer = await workbook.xlsx.writeBuffer({ useStyles: true });
  const url = URL.createObjectURL(new Blob([buffer], { type: spreadsheetMime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
