import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const baseMigration = '20261015210151_enforce_active_employee_access_and_sp_dates.sql';
const grantMigration = '20261108043421_restrict_api_grants_and_limit_email_abuse.sql';
const fixMigration = '20261110203511_enforce_document_contract_authorization.sql';
const readMigration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');

test('document access enforces the current employment type without breaking authorized access', async (t) => {
  const db = new PGlite();
  const [clt, colleague, pj, admin, inactive] = [1, 2, 3, 4, 5].map((n) => `10000000-0000-0000-0000-00000000000${n}`);
  const path = (id, file = 'existing.pdf') => `${id}/${file}`;
  const readDocs = () => db.query('select funcionario_id from public.documentos order by funcionario_id');
  const readFiles = () => db.query("select name from storage.objects where bucket_id = 'documentos' order by name");
  const upload = (name, bucket = 'documentos') => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, name]);
  const insert = (owner, name) => db.query("insert into public.documentos(funcionario_id,tipo,nome_arquivo,caminho_storage) values($1,'atestado','fixture.pdf',$2)", [owner, name]);
  const remove = (name) => db.query("delete from storage.objects where bucket_id='documentos' and name=$1 returning name", [name]);

  async function as(actor, run, role = 'authenticated') {
    await db.exec('BEGIN');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor || '']);
      await db.exec(`SET LOCAL ROLE ${role}`);
      await run();
    } finally {
      await db.exec('ROLLBACK');
    }
  }

  async function policy(migration, name) {
    const source = await readMigration(migration);
    const marker = `CREATE POLICY "${name}"`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Missing original policy: ${name}`);
    await db.exec(source.slice(start, source.indexOf(';', start + marker.length) + 1));
  }

  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
        SELECT parts[1:cardinality(parts)-1] FROM (SELECT string_to_array(name,'/') AS parts) AS split
      $$;
      CREATE TABLE public.funcionarios(id uuid PRIMARY KEY, auth_id uuid NOT NULL, role text, ativo boolean, tipo_contrato text);
      CREATE TABLE storage.objects(bucket_id text, name text, PRIMARY KEY(bucket_id,name));
      CREATE TABLE public.documentos(funcionario_id uuid REFERENCES public.funcionarios(id), tipo text,
        nome_arquivo text, caminho_storage text, periodo_inicio date, periodo_fim date);
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
        SELECT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=auth.uid() AND role='admin' AND ativo=true)
      $$;
      ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY profile_read ON public.funcionarios FOR SELECT TO authenticated
        USING (auth_id=auth.uid() OR public.is_admin());
      GRANT SELECT ON public.funcionarios,public.documentos TO authenticated;
      GRANT INSERT(funcionario_id,tipo,nome_arquivo,caminho_storage,periodo_inicio,periodo_fim) ON public.documentos TO authenticated;
      GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
      GRANT SELECT ON storage.objects TO anon;
    `);
    for (const name of [
      'Funcionário ativo lê os próprios documentos; admin lê todos',
      'Funcionário ativo envia documento para a própria pasta',
      'Funcionário ativo ou admin lê documento autorizado',
      'Funcionário ativo remove somente documento órfão próprio',
      'Funcionário ativo envia foto para a própria pasta',
    ]) await policy(baseMigration, name);
    await policy(grantMigration, 'Funcionário ativo envia somente os próprios documentos');
    await db.exec(await readMigration(fixMigration));

    for (const [id, role, active, contract] of [
      [clt, 'employee', true, 'clt'], [colleague, 'employee', true, 'clt'],
      [pj, 'employee', true, 'pj'], [admin, 'admin', true, 'pj'], [inactive, 'admin', false, 'clt'],
    ]) {
      await db.query('insert into public.funcionarios values($1,$1,$2,$3,$4)', [id, role, active, contract]);
      await upload(path(id));
      await insert(id, path(id));
    }
    await upload(path(clt, 'orphan.pdf'));
    await upload(path(pj, 'orphan.pdf'));

    await t.test('PJ cannot read, upload, register or delete documents, including legacy objects', () => as(pj, async () => {
      assert.deepEqual((await readDocs()).rows, []);
      assert.deepEqual((await readFiles()).rows, []);
      assert.equal((await remove(path(pj))).rows.length, 0);
      assert.equal((await remove(path(pj, 'orphan.pdf'))).rows.length, 0);
      // Use savepoints to keep testing the same authenticated transaction after denial.
      await db.exec('SAVEPOINT before_upload');
      await assert.rejects(upload(path(pj, 'new.pdf')), { code: '42501' });
      await db.exec('ROLLBACK TO before_upload');
      await assert.rejects(insert(pj, path(pj, 'orphan.pdf')), { code: '42501' });
    }));

    await t.test('CLT can upload, register, read and clean its own orphan without seeing colleagues', () => as(clt, async () => {
      assert.deepEqual((await readDocs()).rows, [{ funcionario_id: clt }]);
      assert.deepEqual((await readFiles()).rows.map((r) => r.name), [path(clt), path(clt, 'orphan.pdf')]);
      await upload(path(clt, 'new.pdf'));
      await insert(clt, path(clt, 'new.pdf'));
      assert.equal((await remove(path(clt, 'new.pdf'))).rows.length, 0);
      assert.equal((await remove(path(clt, 'orphan.pdf'))).rows.length, 1);
      await db.exec('SAVEPOINT before_cross_upload');
      await assert.rejects(upload(path(colleague, 'cross.pdf')), { code: '42501' });
      await db.exec('ROLLBACK TO before_cross_upload');
      await assert.rejects(insert(clt, path(colleague)), { code: '42501' });
    }));

    await t.test('active admin can read all documents and upload its own regardless of contract', () => as(admin, async () => {
      assert.equal((await readDocs()).rows.length, 5);
      assert.equal((await readFiles()).rows.length, 7);
      await upload(path(admin, 'new.pdf'));
      await insert(admin, path(admin, 'new.pdf'));
      await upload(path(admin, 'orphan.pdf'));
      assert.equal((await remove(path(admin, 'orphan.pdf'))).rows.length, 1);
      assert.equal((await remove(path(colleague))).rows.length, 0);
      await assert.rejects(insert(colleague, path(colleague)), { code: '42501' });
    }));

    await t.test('inactive admins and anonymous users remain blocked', async () => {
      await as(inactive, async () => {
        assert.deepEqual((await readDocs()).rows, []);
        assert.deepEqual((await readFiles()).rows, []);
        await assert.rejects(upload(path(inactive, 'new.pdf')), { code: '42501' });
      });
      await as(null, async () => {
        assert.deepEqual((await readFiles()).rows, []);
        await assert.rejects(readDocs(), { code: '42501' });
      }, 'anon');
    });

    await t.test('changing CLT to PJ hides existing documents without deleting them', async () => {
      await db.query("update public.funcionarios set tipo_contrato='pj' where id=$1", [clt]);
      await as(clt, async () => {
        assert.deepEqual((await readDocs()).rows, []);
        assert.deepEqual((await readFiles()).rows, []);
        assert.equal((await remove(path(clt))).rows.length, 0);
        assert.equal((await remove(path(clt, 'orphan.pdf'))).rows.length, 0);
      });
      assert.equal((await db.query('select * from public.documentos where funcionario_id=$1', [clt])).rows.length, 1);
      assert.equal((await db.query("select * from storage.objects where bucket_id='documentos' and name=$1", [path(clt)])).rows.length, 1);
    });

    await t.test('PJ avatar uploads are unaffected by the documents policy', () => as(pj, () => upload(path(pj, 'avatar.png'), 'fotos-funcionarios')));
  } finally {
    await db.close();
  }
});
