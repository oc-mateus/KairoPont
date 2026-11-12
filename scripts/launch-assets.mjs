import { readFile, writeFile, mkdir, readdir, unlink, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_SITE_URL, PAGE_METADATA, metadataHtml, siteUrl } from '../shared/site.mjs';

export function launchAssets({ baseUrl = DEFAULT_SITE_URL } = {}) {
  let root, out, written = false;
  let offlineFiles;
  return {
    name: 'public-route-documents', apply: 'build',
    configResolved(config) { root = config.root; out = resolve(root, config.build.outDir); },
    transformIndexHtml(html) {
      return html.replace(/<!-- page-meta:start -->[\s\S]*?<!-- page-meta:end -->/, `<!-- page-meta:start -->\n    ${metadataHtml('/', baseUrl)}\n    <!-- page-meta:end -->`);
    },
    generateBundle(_options, bundle) {
      const files = new Set(['assets/brand/web/mark-96.webp', 'manifest.webmanifest']);
      const visit = (chunk) => {
        if (!chunk || chunk.type !== 'chunk' || files.has(chunk.fileName)) return;
        files.add(chunk.fileName);
        for (const name of chunk.viteMetadata?.importedCss ?? []) files.add(name);
        for (const name of chunk.viteMetadata?.importedAssets ?? []) files.add(name);
        for (const name of chunk.imports) visit(bundle[name]);
      };
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const punch = chunks.find((item) => item.facadeModuleId?.endsWith('/pages/PunchPage.jsx'));
      if (!punch) throw new Error('The offline bundle must include the punch page.');
      visit(punch);
      for (const chunk of chunks) {
        if (chunk.isEntry || chunk.facadeModuleId?.endsWith('/pages/LoginPage.jsx')) visit(chunk);
      }
      for (const file of Object.keys(bundle)) {
        if (file.endsWith('.woff2')) files.add(file);
      }
      offlineFiles = [...files].sort();
    },
    writeBundle() { written = true; },
    async closeBundle() {
      if (!written) return;
      if (!relative(root, out) || relative(root, out).startsWith('..')) throw new Error('Build output must stay inside the project.');
      const index = await readFile(resolve(out,'index.html'),'utf8');
      const workerPath = resolve(out, 'sw.js');
      const worker = await readFile(workerPath, 'utf8');
      const version = createHash('sha256').update(index).update(JSON.stringify(offlineFiles)).digest('hex').slice(0, 16);
      await writeFile(workerPath, worker
        .replace("'offline-build-version'", JSON.stringify(version))
        .replace('/* offline-build-files */ []', JSON.stringify(offlineFiles)));
      const render = (path) => index.replace(/<!-- page-meta:start -->[\s\S]*?<!-- page-meta:end -->/, `<!-- page-meta:start -->\n    ${metadataHtml(path,baseUrl)}\n    <!-- page-meta:end -->`);
      for (const path of Object.keys(PAGE_METADATA).filter(path => path !== '/' && !path.startsWith('/admin') && !['/ponto','/historico','/documentos','/perfil','/ferias'].includes(path))) {
        const file=resolve(out,path.slice(1),'index.html'); await mkdir(dirname(file),{recursive:true}); await writeFile(file,render(path));
      }
      await writeFile(resolve(out,'404.html'),render('/pagina-inexistente'));
      const pages=Object.entries(PAGE_METADATA).filter(([,meta])=>meta.index).map(([path])=>siteUrl(path,baseUrl));
      await writeFile(resolve(out,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+pages.map(url=>`  <url><loc>${url}</loc></url>`).join('\n')+'\n</urlset>\n');
      await writeFile(resolve(out,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${siteUrl('sitemap.xml',baseUrl)}\n`);
      // Keep originals in source control, but do not ship unused design masters.
      const brand=resolve(out,'assets/brand');
      const legacyIcons=new Map([['kairopont-pwa-192.png','icon-192.png'],['kairopont-pwa-512.png','icon-512.png'],['kairopont-pwa-512-maskable.png','icon-maskable-512.png']]);
      for (const entry of await readdir(brand,{withFileTypes:true})) {
        if (entry.isFile() && !legacyIcons.has(entry.name)) await unlink(resolve(brand,entry.name));
      }
      for(const [legacy,compressed] of legacyIcons) await copyFile(resolve(brand,'web',compressed),resolve(brand,legacy));
    },
  };
}
