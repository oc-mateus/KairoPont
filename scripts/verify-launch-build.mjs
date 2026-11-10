import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { PAGE_METADATA } from '../shared/site.mjs';

const root=resolve('dist');
const index=await readFile(resolve(root,'index.html'),'utf8');
assert.match(index,/Content-Security-Policy/);
assert.doesNotMatch(index,/fonts\.googleapis|googletagmanager|google-analytics/);
assert.match(index,/favicon\.ico/);
for(const [path,meta] of Object.entries(PAGE_METADATA).filter(([path])=>path==='/'||!['/ponto','/historico','/documentos','/perfil','/ferias'].includes(path)&&!path.startsWith('/admin'))){
  const file=path==='/'?'index.html':`${path.slice(1)}/index.html`;
  const html=await readFile(resolve(root,file),'utf8');
  assert.ok(html.includes(meta.title));
  assert.ok(html.includes(meta.index?'index,follow':'noindex,nofollow'));
}
const notFound=await readFile(resolve(root,'404.html'),'utf8');
assert.match(notFound,/Página não encontrada/);
assert.match(notFound,/noindex,nofollow/);
const sitemap=await readFile(resolve(root,'sitemap.xml'),'utf8');
assert.doesNotMatch(sitemap,/admin|login|perfil|historico|ponto<|confirmacao/);
assert.match(sitemap,/contato/);
const image=await sharp(resolve(root,'assets/brand/web/og-kairopont.png')).metadata();
assert.equal(image.width,1200);assert.equal(image.height,630);
const manifest=JSON.parse(await readFile(resolve(root,'manifest.webmanifest'),'utf8'));
for(const icon of manifest.icons)assert.ok((await stat(resolve(root,icon.src))).size>0);
assert.ok((await stat(resolve(root,'assets/brand/web/mark-96.webp'))).size<10000);
assert.ok(await stat(resolve(root,'licenses/third-party-notices.txt')));
for(const unused of ['kairo-logo.png','kairo-logo-branco.png','kairo-logo-preto.png','kairo-nome.png']){
  await assert.rejects(stat(resolve(root,'assets/brand',unused)),{code:'ENOENT'});
}
console.log('Launch documents, icons, image budgets, privacy defaults and public indexing verified.');
