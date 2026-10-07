async function getOfficialKairoLogo(pdf) {
  const logoUrl = new URL(
    `${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`,
    window.location.origin,
  );
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error('Não foi possível carregar a logo oficial da Kairo.');
  const blob = await response.blob();
  const logoDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível preparar a logo oficial da Kairo.'));
    reader.readAsDataURL(blob);
  });

  const dimensions = pdf.getImageProperties(logoDataUrl);
  const logoWidth = 38;
  const logoHeight = logoWidth * (dimensions.height / dimensions.width);
  pdf.addImage(logoDataUrl, 'PNG', 14, 12, logoWidth, logoHeight);
}

function drawKairoPontBrand(pdf, offsetX = 0) {
  // Símbolo de relógio e marcação inspirado na paleta verde e vermelha da Kairo.
  pdf.setFillColor(241, 248, 243);
  pdf.circle(23 + offsetX, 17, 9, 'F');
  pdf.setDrawColor(20, 91, 47);
  pdf.setLineWidth(1.2);
  pdf.circle(23 + offsetX, 17, 8, 'S');
  pdf.setLineWidth(1.1);
  pdf.line(23 + offsetX, 12.5, 23 + offsetX, 17);
  pdf.line(23 + offsetX, 17, 26.2 + offsetX, 18.8);
  pdf.setDrawColor(194, 45, 42);
  pdf.setLineWidth(1.4);
  pdf.line(27.1 + offsetX, 22.1, 29.2 + offsetX, 24.1);
  pdf.line(29.2 + offsetX, 24.1, 33.1 + offsetX, 19.6);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(19);
  pdf.setTextColor(15, 72, 39);
  pdf.text('KAIRO', 39 + offsetX, 18);
  const pontX = 39 + offsetX + pdf.getTextWidth('KAIRO') + 0.6;
  pdf.setTextColor(49, 137, 69);
  pdf.text('PONT', pontX, 18);

  pdf.setDrawColor(194, 45, 42);
  pdf.setLineWidth(1.1);
  pdf.line(pontX, 21.1, pontX + pdf.getTextWidth('PONT'), 21.1);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(100, 112, 104);
  pdf.text('CONTROLE DE PONTO', 39 + offsetX, 26);
}

export async function addKairoPdfHeader(pdf, { title, details = [] }) {
  await getOfficialKairoLogo(pdf);
  pdf.setDrawColor(190, 200, 193);
  pdf.setLineWidth(0.35);
  pdf.line(56, 9, 56, 26);
  drawKairoPontBrand(pdf, 58);

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
