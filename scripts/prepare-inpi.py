"""Build a reviewable source snapshot and hashes; never submit or sign a filing."""
import base64
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parent.parent
output = root / 'output' / 'registro'
output.mkdir(parents=True, exist_ok=True)
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode('utf-8').split('\0')
extensions = {'.js', '.jsx', '.mjs', '.ts', '.css', '.html', '.json', '.sql', '.py', '.webmanifest'}
roots = ('src/', 'shared/', 'supabase/functions/', 'supabase/migrations/', 'scripts/')
standalone = {'package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'public/sw.js', 'public/manifest.webmanifest'}
files = sorted({name for name in paths if name and (name.startswith(roots) or name in standalone)
                and Path(name).suffix in extensions and not any(part.startswith('.') for part in Path(name).parts)})
assert files and all('.env' not in Path(name).parts and 'node_modules' not in Path(name).parts for name in files)
archive = output / 'KairoPont-codigo-fonte.zip'
manifest = []
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
    for name in files:
        path = (root / name).resolve()
        assert path.is_relative_to(root)
        data = path.read_bytes()
        # Fail closed on recognizable privileged keys without printing a secret.
        assert not re.search(rb'(?:sb_secret_|sk-proj-)[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----', data), f'Review sensitive content in {name}'
        for token in re.findall(rb'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', data):
            part = token.split(b'.')[1]
            try:
                claims = json.loads(base64.urlsafe_b64decode(part + b'=' * (-len(part) % 4)))
            except (ValueError, UnicodeDecodeError):
                continue
            assert claims.get('role') != 'service_role', f'Review privileged token in {name}'
        info = zipfile.ZipInfo(name, date_time=(2026, 11, 10, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        zipped.writestr(info, data)
        manifest.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
digest = hashlib.sha512(archive.read_bytes()).hexdigest()
snapshot = {
    'status': 'preparado_para_revisao_nao_protocolado',
    'software': 'KairoPont', 'version': json.loads((root / 'package.json').read_text())['version'],
    'intended_holder': 'Mateus de Campos Oliveira', 'holder_type': 'pessoa_fisica',
    'authors': 'a confirmar pelo requerente', 'original_creation_date': 'a confirmar pelo requerente',
    'git_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'uncommitted_changes_included': bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root).strip()),
    'prepared_at_utc': datetime.now(timezone.utc).isoformat(), 'archive': archive.name,
    'sha512': digest, 'files': manifest,
    'excluded': ['credentials', 'installed dependencies', 'build output', 'customer data', 'personal documents', 'brand artwork'],
}
(output / 'manifesto.json').write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
(output / 'SHA512.txt').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
(output / 'LEIA-ME.txt').write_text('Material preparado para revisão de Mateus de Campos Oliveira. Não é um registro no INPI.\n'
    'Confira autoria, titularidade e datas antes de assinar. Preserve o ZIP sem alterações e use o SHA-512 correspondente.\n'
    'Consulte docs/REGISTROS_INPI.md no projeto para os próximos passos oficiais.\n', encoding='utf-8')
with zipfile.ZipFile(archive) as check:
    assert check.testzip() is None and len(check.infolist()) == len(files)
print(json.dumps({'files': len(files), 'bytes': archive.stat().st_size, 'sha512': digest, 'status': snapshot['status']}))
