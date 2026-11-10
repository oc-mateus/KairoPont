import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('metadata creation times preserve the actual instant in UTC and São Paulo sessions', async () => {
  const db = new PGlite();
  try {
    for (const table of ['funcionarios', 'documentos', 'auditoria']) {
      await db.exec(`CREATE TABLE ${table}(id integer, created_at timestamptz DEFAULT timezone('America/Sao_Paulo', now())); INSERT INTO ${table}(id,created_at) VALUES(1,'2026-11-10T12:00:00Z');`);
    }
    await db.exec(await readFile(new URL('../migrations/20261110194104_correct_metadata_timestamps.sql', import.meta.url), 'utf8'));
    for (const zone of ['UTC', 'America/Sao_Paulo']) {
      await db.exec(`SET TIME ZONE '${zone}'; BEGIN;`);
      for (const table of ['funcionarios', 'documentos', 'auditoria']) {
        const { rows } = await db.query(`INSERT INTO ${table}(id) VALUES(2) RETURNING created_at = now() AS correct_instant`);
        assert.equal(rows[0].correct_instant, true, `${table} in ${zone}`);
        const previous = await db.query(`SELECT created_at = '2026-11-10T12:00:00Z'::timestamptz AS preserved FROM ${table} WHERE id=1`);
        assert.equal(previous.rows[0].preserved, true);
      }
      await db.exec('ROLLBACK;');
    }
  } finally {
    await db.close();
  }
});
