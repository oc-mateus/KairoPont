async function getKairoLogoDataUrl() {
  const logoUrl = `${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`;
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error('Não foi possível carregar a logo da Kairo.');
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível preparar a logo da Kairo.'));
    reader.readAsDataURL(blob);
  });
}

export async function addKairoPdfHeader(pdf, { title, details = [] }) {
  let textX = 14;
  try {
    const logo = await getKairoLogoDataUrl();
    const dimensions = pdf.getImageProperties(logo);
    const logoWidth = 42;
    const logoHeight = logoWidth * (dimensions.height / dimensions.width);
    pdf.addImage(logo, 'PNG', 14, 8, logoWidth, logoHeight);
    textX = 64;
  } catch {
    // The text header remains complete if the optional logo cannot be loaded.
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(17);
  pdf.setTextColor(27, 94, 32);
  pdf.text('KairoPont', textX, 17);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(90, 90, 90);
  pdf.text('Kairo Automações', textX, 23);
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
