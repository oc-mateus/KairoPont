import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAvatarUrl } from './avatarUrl.js';

const project = 'https://leupokvtpdqgggppjras.supabase.co';
const path = '/storage/v1/object/public/fotos-funcionarios/10000000-0000-0000-0000-000000000001/foto.jpg';

test('managed avatar URLs allow only images in this project public photo bucket', () => {
  assert.equal(safeAvatarUrl(project + path, project), project + path);
  assert.equal(safeAvatarUrl(project + path + '?t=1794320000000', project), project + path + '?t=1794320000000');
});

test('stored avatar URLs cannot request trackers, another project, private files or active content', () => {
  for (const url of [null, '', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//evil.invalid/foto.jpg',
    'https://evil.invalid/tracker.gif', project.replace('leupokvtpdqgggppjras', 'attacker') + path,
    project + '.evil.invalid' + path, 'https://evil.invalid@leupokvtpdqgggppjras.supabase.co' + path,
    project + path.replace('/public/', '/authenticated/'), project + path.replace('fotos-funcionarios', 'documentos'),
    project + path.replace('foto.jpg', 'foto.svg'), project + path + '?redirect=https://evil.invalid',
    project + path + '#fragment', project + path.replace('foto.jpg', '%2e%2e%2ffoto.jpg')]) {
    assert.equal(safeAvatarUrl(url, project), null, String(url));
  }
});
