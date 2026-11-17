async function getBrandLogoData(fileName, brandName) {
  const logoUrl = new URL(
    `${import.meta.env.BASE_URL}assets/brand/web/${fileName}`,
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

export function addPjSignatureFields(pdf, afterTableY) {
  const margin = 14;
  const fieldGap = 10;
  const fieldWidth = (pdf.internal.pageSize.getWidth() - 2 * margin - fieldGap) / 2;
  const fieldHeight = 18;
  let y = afterTableY + 10;

  if (y + 40 > pdf.internal.pageSize.getHeight() - 18) {
    pdf.addPage();
    y = 20;
  }

  pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(60);
  pdf.text('Assinaturas digitais', margin, y);
  pdf.setFont('helvetica', 'normal').setFontSize(8);
  pdf.text('Abra o PDF em um leitor compatível e assine com seu certificado digital.', margin, y + 5);

  const fields = [
    ['Prestador PJ', 'Assinatura_Prestador_PJ'],
    ['Responsável pela empresa', 'Assinatura_Responsavel_Empresa'],
  ];
  fields.forEach(([label, fieldName], index) => {
    const x = margin + index * (fieldWidth + fieldGap);
    const top = y + 14;
    pdf.text(label, x, top - 2);
    pdf.setDrawColor(160).setLineWidth(0.25).rect(x, top, fieldWidth, fieldHeight);

    // jsPDF provides the widget and form registration. Use a signature field type
    // with no value so each signer can append their own digital signature.
    const field = new pdf.AcroFormTextField();
    field.FT = '/Sig';
    field.fieldName = fieldName;
    field.Rect = [x, top, fieldWidth, fieldHeight];
    pdf.addField(field);
  });

  // The AcroForm serializer emits additional non-configurable PDF dictionary keys.
  Object.defineProperty(pdf.internal.acroformPlugin.acroFormDictionaryRoot, 'SigFlags', { value: 3 });
}
