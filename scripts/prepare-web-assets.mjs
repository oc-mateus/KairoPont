import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const brand = resolve('public/assets/brand');
const web = resolve(brand, 'web');
await mkdir(web, { recursive: true });
const icon = await readFile(resolve(brand, 'kairopont-pwa-512.png'));
const png = { compressionLevel: 9, effort: 10, palette: true, quality: 95 };
for (const size of [16, 32, 180, 192, 512]) {
  await sharp(icon).resize(size, size).png(png).toFile(resolve(web, `icon-${size}.png`));
}
await sharp(icon).resize(96, 96).webp({ quality: 88, effort: 6 }).toFile(resolve(web, 'mark-96.webp'));
await sharp(resolve(brand, 'kairopont-pwa-512-maskable.png')).resize(512, 512).png(png).toFile(resolve(web, 'icon-maskable-512.png'));
for (const [name, width] of [['kairopont-logo-3d.png', 900], ['adesivo_nome_simbolo.png', 900]]) {
  await sharp(resolve(brand, name)).resize({ width, withoutEnlargement: true }).png(png).toFile(resolve(web, name));
}
// The ICO contains the actual brand artwork at both browser favicon sizes.
const frames = await Promise.all([16,32].map(size => readFile(resolve(web, `icon-${size}.png`))));
const header = Buffer.alloc(6 + frames.length * 16); header.writeUInt16LE(1,2); header.writeUInt16LE(frames.length,4);
let offset = header.length;
frames.forEach((frame,index) => {
  const start=6+index*16, size=[16,32][index]; header[start]=size; header[start+1]=size;
  header.writeUInt16LE(1,start+4); header.writeUInt16LE(32,start+6);
  header.writeUInt32LE(frame.length,start+8); header.writeUInt32LE(offset,start+12); offset+=frame.length;
});
await writeFile(resolve('public/favicon.ico'), Buffer.concat([header,...frames]));
const logo=await sharp(resolve(brand,'kairopont-logo-3d.png')).resize({width:800}).png().toBuffer();
const type=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><text x="600" y="470" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" fill="#254535">Registro e gestão de jornada</text><text x="600" y="530" text-anchor="middle" font-family="Arial,sans-serif" font-size="21" fill="#49604f">Acesso individual · Histórico · Administração</text></svg>');
await sharp({create:{width:1200,height:630,channels:4,background:'#f5f6ef'}})
  .composite([{input:logo,left:200,top:120},{input:type}]).png(png).toFile(resolve(web,'og-kairopont.png'));
console.log('Prepared brand icons, compressed report logos and 1200×630 sharing image.');
