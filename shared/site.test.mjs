import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageMetadata, metadataHtml, siteUrl, PAGE_METADATA } from './site.mjs';

test('each application route has a distinct title and appropriate indexing',()=>{
  const titles=Object.values(PAGE_METADATA).map(meta=>meta.title);
  assert.equal(new Set(titles).size,titles.length);
  for(const path of ['/admin','/admin/funcionarios','/perfil','/historico','/ponto','/login','/suporte/confirmacao']){
    assert.equal(getPageMetadata(path).index,false);
    assert.match(metadataHtml(path),/noindex,nofollow/);
    assert.doesNotMatch(metadataHtml(path),/rel="canonical"/);
  }
  assert.equal(getPageMetadata('/contato/').index,true);
  assert.equal(getPageMetadata('/does-not-exist').notFound,true);
});

test('public metadata uses the project base path without personal query strings',()=>{
  assert.equal(siteUrl('/contato'), 'https://oc-mateus.github.io/KairoPont/contato');
  const html=metadataHtml('/privacidade');
  assert.match(html,/og:image/);
  assert.match(html,/\/KairoPont\/privacidade/);
  assert.match(html,/index,follow/);
  assert.doesNotMatch(html,/funcionario=/);
});
