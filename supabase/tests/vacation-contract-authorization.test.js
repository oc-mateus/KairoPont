import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const readMigration = (name) => readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');

test('vacation permissions follow the current contract and preserve administrative history', async (t) => {
  const db = new PGlite();
  const owner = '10000000-0000-0000-0000-000000000001';
  const colleague = '10000000-0000-0000-0000-000000000002';
  const admin = '10000000-0000-0000-0000-000000000003';
  const inactive = '10000000-0000-0000-0000-000000000004';
  const tables = ['periodos_aquisitivos_ferias', 'solicitacoes_ferias', 'notificacoes'];

  async function as(actor, run) {
    await db.exec('BEGIN');
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await db.exec('SET LOCAL ROLE authenticated');
      await run();
    } finally {
      await db.exec('ROLLBACK');
    }
  }

  async function visibleOwners(table) {
    const { rows } = await db.query(`SELECT funcionario_id FROM public.${table} ORDER BY funcionario_id`);
    return rows.map(({ funcionario_id }) => funcionario_id);
  }

  const markRead = (id) => db.query(
    'UPDATE public.notificacoes SET lida_em = now() WHERE funcionario_id = $1 RETURNING lida_em',
    [id],
  );

  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE TABLE public.funcionarios (
        id uuid PRIMARY KEY, auth_id uuid NOT NULL, role text, ativo boolean, tipo_contrato text
      );
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.funcionarios WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true
        )
      $$;
      ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
      CREATE POLICY profile_read ON public.funcionarios FOR SELECT TO authenticated
        USING (auth_id = auth.uid() OR public.is_admin());
      GRANT SELECT ON public.funcionarios TO authenticated;
    `);

    const schema = await readMigration('20261007162427_vacation_requests_employee_schedule');
    const schemaStart = schema.indexOf('CREATE TABLE public.periodos_aquisitivos_ferias (');
    const schemaEnd = schema.indexOf('CREATE POLICY "Funcionário e admin consultam períodos de férias autorizados"');
    assert.ok(schemaStart >= 0 && schemaEnd > schemaStart);
    await db.exec(schema.slice(schemaStart, schemaEnd));

    const policies = await readMigration('20261015210151_enforce_active_employee_access_and_sp_dates');
    const policyStart = policies.indexOf('CREATE POLICY "Funcionário ativo e admin consultam períodos de férias autorizados"');
    const policyEnd = policies.indexOf('DROP POLICY IF EXISTS "Funcionário envia documento para a própria pasta"');
    assert.ok(policyStart >= 0 && policyEnd > policyStart);
    await db.exec(policies.slice(policyStart, policyEnd));

    await db.exec(await readMigration('20261112040943_enforce_vacation_contract_authorization'));

    await db.query(`
      INSERT INTO public.funcionarios VALUES
        ($1, $1, 'employee', true, 'clt'),
        ($2, $2, 'employee', true, 'clt'),
        ($3, $3, 'admin', true, 'pj'),
        ($4, $4, 'admin', false, 'clt')
    `, [owner, colleague, admin, inactive]);
    await db.exec(`
      INSERT INTO public.periodos_aquisitivos_ferias
        (funcionario_id, periodo_inicio, periodo_fim, prazo_concessivo)
        SELECT id, '2024-01-01', '2024-12-31', '2025-12-31' FROM public.funcionarios;
      INSERT INTO public.solicitacoes_ferias (funcionario_id, periodo_id, data_inicio, data_fim)
        SELECT funcionario_id, id, '2025-02-01', '2025-03-02' FROM public.periodos_aquisitivos_ferias;
      INSERT INTO public.notificacoes (funcionario_id, tipo, titulo, mensagem, referencia)
        SELECT id, 'ferias_vencidas', 'Férias', 'Aviso de férias', id::text FROM public.funcionarios;
    `);

    await t.test('active CLT can read own history and mark only own notices as read', () => as(owner, async () => {
      for (const table of tables) assert.deepEqual(await visibleOwners(table), [owner]);
      assert.equal((await markRead(colleague)).rows.length, 0);
      const { rows } = await markRead(owner);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].lida_em);
    }));

    await t.test('the same authenticated owner loses vacation access after conversion to PJ', async () => {
      await db.query("UPDATE public.funcionarios SET tipo_contrato = 'pj' WHERE id = $1", [owner]);
      await as(owner, async () => {
        for (const table of tables) assert.deepEqual(await visibleOwners(table), []);
        assert.equal((await markRead(owner)).rows.length, 0);
      });
      assert.deepEqual(await visibleOwners('notificacoes'), [owner, colleague, admin, inactive]);
    });

    await t.test('active administrator retains historical period and request access', () => as(admin, async () => {
      for (const table of tables.slice(0, 2)) {
        assert.deepEqual(await visibleOwners(table), [owner, colleague, admin, inactive]);
      }
      assert.deepEqual(await visibleOwners('notificacoes'), []);
      assert.equal((await markRead(owner)).rows.length, 0);
    }));

    await t.test('inactive administrator cannot read or modify vacation data', () => as(inactive, async () => {
      for (const table of tables) assert.deepEqual(await visibleOwners(table), []);
      assert.equal((await markRead(inactive)).rows.length, 0);
    }));
  } finally {
    await db.close();
  }
});
