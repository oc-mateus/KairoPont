import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) => readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');

test('contract history, vacation reconciliation and avatar policies preserve existing data', async (t) => {
  const db = new PGlite();
  const employee = '10000000-0000-0000-0000-000000000001';
  const colleague = '10000000-0000-0000-0000-000000000002';
  const administrator = '10000000-0000-0000-0000-000000000003';
  const employeePath = `${employee}/foto.jpg`;
  const replacementPath = `${employee}/foto-10000000-0000-0000-0000-000000000006.png`;
  const colleaguePath = `${colleague}/foto.webp`;
  const profilePhoto = (path) => `https://example.supabase.co/storage/v1/object/public/fotos-funcionarios/${path}?t=1`;

  async function as(id, run) {
    await db.exec('BEGIN');
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [id]);
      await db.exec('SET LOCAL ROLE authenticated');
      await run();
    } finally {
      await db.exec('ROLLBACK');
    }
  }

  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage;
      GRANT USAGE ON SCHEMA auth, storage TO authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION public.kairopont_today_sp() RETURNS date LANGUAGE sql AS $$ SELECT '2026-11-12'::date $$;
      CREATE TABLE public.funcionarios (
        id uuid PRIMARY KEY, auth_id uuid NOT NULL UNIQUE, ativo boolean NOT NULL, role text NOT NULL,
        tipo_contrato text NOT NULL, data_admissao date, foto_url text
      );
      CREATE TABLE public.registros_ponto (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        funcionario_id uuid REFERENCES public.funcionarios(id), data date NOT NULL,
        entrada time, created_at timestamptz NOT NULL DEFAULT '2026-10-01',
        PRIMARY KEY (funcionario_id, data)
      );
      CREATE TABLE public.feriados (data date PRIMARY KEY, nome text);
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (SELECT 1 FROM public.funcionarios WHERE auth_id = auth.uid() AND ativo AND role = 'admin')
      $$;
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$
        SELECT string_to_array(name, '/')
      $$;
      CREATE TABLE storage.objects (bucket_id text, name text, PRIMARY KEY(bucket_id, name));
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY public_avatars ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'fotos-funcionarios');
      GRANT SELECT, DELETE ON storage.objects TO authenticated;
      GRANT SELECT ON public.funcionarios TO authenticated;
    `);
    const vacationSchema = await migration('20261007162427_vacation_requests_employee_schedule');
    await db.exec(vacationSchema.slice(
      vacationSchema.indexOf('CREATE TABLE public.periodos_aquisitivos_ferias ('),
      vacationSchema.indexOf('CREATE POLICY "Funcionário e admin consultam períodos'),
    ));
    await db.query(`
      INSERT INTO public.funcionarios VALUES
        ($1, $1, true, 'employee', 'clt', '2024-01-01', $4),
        ($2, $2, true, 'employee', 'clt', NULL, $5),
        ($3, $3, true, 'admin', 'pj', NULL, NULL)
    `, [employee, colleague, administrator, profilePhoto(employeePath), profilePhoto(colleaguePath)]);
    await db.query(`
      INSERT INTO public.registros_ponto (funcionario_id, data, entrada)
      VALUES ($1,'2026-10-12','08:00'), ($2,'2026-11-02','08:00')
    `, [employee, colleague]);
    await db.exec("INSERT INTO public.feriados VALUES ('2026-10-12','Feriado A'), ('2026-11-02','Feriado B')");
    await db.query("INSERT INTO storage.objects VALUES ('fotos-funcionarios',$1), ('fotos-funcionarios',$2), ('fotos-funcionarios',$3)", [employeePath, replacementPath, colleaguePath]);
    const historicalPunches = await migration('20261030174501_work_schedules_and_historical_punches');
    await db.exec(historicalPunches.slice(
      historicalPunches.indexOf('CREATE OR REPLACE FUNCTION public.prevent_late_punch_record_changes()'),
      historicalPunches.indexOf("SELECT pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'on', true);"),
    ));
    await db.exec(`
      CREATE TRIGGER prevent_late_punch_record_changes BEFORE UPDATE OR DELETE ON public.registros_ponto
      FOR EACH ROW EXECUTE FUNCTION public.prevent_late_punch_record_changes();
    `);
    await db.exec(await migration('20261112053058_preserve_punch_history_and_vacation_cycles'));

    await t.test('contract changes preserve old punches and date new historical inserts', async () => {
      await db.query("UPDATE public.funcionarios SET tipo_contrato='pj' WHERE id=$1", [employee]);
      await db.query(`
        INSERT INTO public.registros_ponto (funcionario_id, data, entrada)
        VALUES ($1, '2025-01-01', '08:00'), ($1, '2099-01-01', '08:00')
      `, [employee]);
      const { rows } = await db.query("SELECT tipo_contrato FROM public.registros_ponto WHERE funcionario_id=$1 ORDER BY data", [employee]);
      assert.deepEqual(rows.map(({ tipo_contrato }) => tipo_contrato), ['clt', 'clt', 'pj']);
    });

    await t.test('the holiday endpoint exposes dates only for the caller’s punches', () => as(employee, async () => {
      const { rows } = await db.query("SELECT data::text FROM public.list_punch_holiday_dates('2026-10-01','2026-11-30')");
      assert.deepEqual(rows, [{ data: '2026-10-12' }]);
    }));

    await t.test('admission correction replaces unused cycles and keeps a cycle with a decision', async () => {
      await db.query("UPDATE public.funcionarios SET tipo_contrato='clt' WHERE id=$1", [employee]);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [administrator]);
      await db.exec('SELECT public.sync_current_vacation_periods()');
      const readCycles = () => db.query(`
        SELECT id, periodo_inicio::text AS start, substituido_em IS NOT NULL AS archived
        FROM public.periodos_aquisitivos_ferias WHERE funcionario_id=$1 ORDER BY periodo_inicio
      `, [employee]).then(({ rows }) => rows);
      const before = await readCycles();
      assert.equal(before.length, 3);
      await db.query(`
        INSERT INTO public.solicitacoes_ferias (periodo_id, funcionario_id, data_inicio, data_fim, status)
        VALUES ($1,$2,'2025-06-01','2025-06-30','aprovada')
      `, [before[0].id, employee]);
      await db.query("UPDATE public.funcionarios SET data_admissao='2024-02-01' WHERE id=$1", [employee]);
      await db.exec('SELECT public.sync_current_vacation_periods(); SELECT public.sync_current_vacation_periods()');
      const after = await readCycles();
      assert.deepEqual(after.filter(({ archived }) => !archived).map(({ start }) => start), ['2024-01-01', '2025-02-01', '2026-02-01']);
      assert.equal(after.filter(({ archived }) => archived).length, 2);
      assert.equal((await db.query('SELECT periodo_id FROM public.solicitacoes_ferias')).rows[0].periodo_id, before[0].id);
      await assert.rejects(db.query('UPDATE public.periodos_aquisitivos_ferias SET dias_abono=1 WHERE id=$1', [before[1].id]), { code: '22023' });
      await assert.rejects(db.query(`
        INSERT INTO public.solicitacoes_ferias (periodo_id, funcionario_id, data_inicio, data_fim)
        VALUES ($1,$2,'2026-06-01','2026-06-30')
      `, [before[1].id, employee]), { code: '22023' });
    });

    await t.test('only the owner can delete a retired avatar, and the current avatar stays', async () => {
      const remove = (path) => db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [path]);
      await as(employee, async () => {
        assert.deepEqual((await remove(employeePath)).rows, []);
        assert.deepEqual((await remove(colleaguePath)).rows, []);
      });
      await db.query('UPDATE public.funcionarios SET foto_url=$2 WHERE id=$1', [employee, profilePhoto(replacementPath)]);
      await as(employee, async () => {
        assert.deepEqual((await remove(employeePath)).rows, [{ name: employeePath }]);
        assert.deepEqual((await remove(replacementPath)).rows, []);
      });
    });
  } finally {
    await db.close();
  }
});
