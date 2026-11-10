import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const notices=['KairoPont — avisos de componentes de terceiros','Os direitos sobre bibliotecas e fontes permanecem com seus respectivos titulares.',''];
let count=0;
for(const [path,entry] of Object.entries(lock.packages)) {
  if(!path.startsWith('node_modules/')||entry.dev)continue;
  const directory=resolve(path);
  const pkg=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8').catch(()=>'{}'));
  if(!pkg.name)continue;
  notices.push('='.repeat(72),`${pkg.name} ${pkg.version}`,`Licença declarada: ${typeof pkg.license==='string'?pkg.license:entry.license||'consulte o pacote'}`);
  const files=(await readdir(directory)).filter(name=>/^(licen[sc]e|copying)([.-].*)?$/i.test(name));
  for(const name of files){const text=await readFile(resolve(directory,name),'utf8').catch(()=>null);if(text)notices.push(text);}
  if(!files.length)notices.push(`Consulte a distribuição original do pacote ${pkg.name} para seus termos.`);
  notices.push('');count++;
}
await mkdir('public/licenses',{recursive:true});
await writeFile('public/licenses/third-party-notices.txt',notices.join('\n').split('\n').map(line=>line.trimEnd()).join('\n'));
console.log(`Prepared notices for ${count} production components.`);
