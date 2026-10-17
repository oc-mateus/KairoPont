async function getBrandLogoData(fileName, brandName) {
  const logoUrl = new URL(
    `${import.meta.env.BASE_URL}assets/brand/${fileName}`,
    window.location.origin,
  );
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error(`Não foi possível carregar a logo da ${brandName}.`);
  const blob = await response.blob();
  const logoDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Não foi possível preparar a logo da ${brandName}.`));
    reader.readAsDataURL(blob);
  });
  return logoDataUrl;
}

async function addBrandLogo(pdf, { fileName, brandName, x, y, width }) {
  const logoDataUrl = await getBrandLogoData(fileName, brandName);
  const dimensions = pdf.getImageProperties(logoDataUrl);
  const height = width * (dimensions.height / dimensions.width);
  pdf.addImage(logoDataUrl, 'PNG', x, y, width, height);
}

async function getOfficialKairoLogo(pdf) {
  await addBrandLogo(pdf, {
    fileName: 'adesivo_nome_simbolo.png', brandName: 'Kairo Automações', x: 14, y: 12, width: 38,
  });
}

async function getKairoPontLogo(pdf) {
  await addBrandLogo(pdf, {
    fileName: 'kairopont-logo-3d.png', brandName: 'KairoPont', x: 64, y: 8, width: 64,
  });
}

export async function addKairoPdfHeader(pdf, { title, details = [] }) {
  await Promise.all([getOfficialKairoLogo(pdf), getKairoPontLogo(pdf)]);
  pdf.setDrawColor(190, 200, 193);
  pdf.setLineWidth(0.35);
  pdf.line(56, 9, 56, 26);

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
