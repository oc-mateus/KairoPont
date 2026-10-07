function drawKairoPontBrand(pdf) {
  // Símbolo de relógio e marcação inspirado na paleta verde e vermelha da Kairo.
  pdf.setFillColor(241, 248, 243);
  pdf.circle(23, 17, 9, 'F');
  pdf.setDrawColor(20, 91, 47);
  pdf.setLineWidth(1.2);
  pdf.circle(23, 17, 8, 'S');
  pdf.setLineWidth(1.1);
  pdf.line(23, 12.5, 23, 17);
  pdf.line(23, 17, 26.2, 18.8);
  pdf.setDrawColor(194, 45, 42);
  pdf.setLineWidth(1.4);
  pdf.line(27.1, 22.1, 29.2, 24.1);
  pdf.line(29.2, 24.1, 33.1, 19.6);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(19);
  pdf.setTextColor(15, 72, 39);
  pdf.text('KAIRO', 39, 18);
  const pontX = 39 + pdf.getTextWidth('KAIRO') + 0.6;
  pdf.setTextColor(49, 137, 69);
  pdf.text('PONT', pontX, 18);

  pdf.setDrawColor(194, 45, 42);
  pdf.setLineWidth(1.1);
  pdf.line(pontX, 21.1, pontX + pdf.getTextWidth('PONT'), 21.1);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(100, 112, 104);
  pdf.text('CONTROLE DE PONTO', 39, 26);
}

export function addKairoPdfHeader(pdf, { title, details = [] }) {
  drawKairoPontBrand(pdf);

  pdf.setDrawColor(46, 125, 50);
  pdf.setLineWidth(0.5);
  pdf.line(14, 30, 196, 30);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(60, 60, 60);
  pdf.text(title, 14, 38);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(90, 90, 90);
  details.forEach((detail, index) => pdf.text(detail, 14, 45 + (index * 6)));

  return 49 + (details.length * 6);
}
