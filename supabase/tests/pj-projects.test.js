import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('project membership, completion and report snapshots enforce account access', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    CREATE TABLE public.funcionarios(id uuid PRIMARY KEY, auth_id uuid, nome text, role text, ativo boolean, tipo_contrato text);
    CREATE TABLE public.auditoria(admin_id uuid, acao text, detalhes jsonb, created_at timestamptz);
    CREATE TABLE public.registros_ponto(id uuid PRIMARY KEY, funcionario_id uuid, data date, entrada time, saida time);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=auth.uid() AND role='admin' AND ativo=true)
    $$;
    ALTER TABLE funcionarios ENABLE ROW LEVEL SECURITY;
    ALTER TABLE registros_ponto ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON funcionarios, registros_ponto TO authenticated;
    CREATE POLICY employee_read ON funcionarios FOR SELECT TO authenticated USING(auth_id=auth.uid() OR public.is_admin());
    CREATE POLICY record_read ON registros_ponto FOR SELECT TO authenticated USING(
      public.is_admin() OR funcionario_id IN (SELECT id FROM funcionarios WHERE auth_id=auth.uid() AND ativo=true)
    );
  `);
  const migration = new URL('../migrations/20261116215820_pj_projects.sql', import.meta.url);
  await db.exec(await readFile(migration, 'utf8'));

  const ids = Array.from({ length: 6 }, (_, index) => `10000000-0000-0000-0000-00000000000${index}`);
  const [admin, member, teammate, outsider, clt, inactive] = ids;
  for (const [id, name, role, active, type] of [
    [admin, 'Admin', 'admin', true, 'clt'],
    [member, 'Prestador A', 'employee', true, 'pj'],
    [teammate, 'Prestador B', 'employee', true, 'pj'],
    [outsider, 'Prestador C', 'employee', true, 'pj'],
    [clt, 'Funcionário CLT', 'employee', true, 'clt'],
    [inactive, 'Prestador inativo', 'employee', false, 'pj'],
  ]) {
    await db.query('INSERT INTO funcionarios VALUES ($1,$1,$2,$3,$4,$5)', [id, name, role, active, type]);
  }

  async function as(actor, action) {
    await db.exec('BEGIN');
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor ?? '']);
      await db.exec(actor ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
      const result = await action();
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  const save = (people, projectId = null, revision = null) => db.query(
    "SELECT salvar_contrato_pj($1,$2,'Implantação','CT-001',NULL,NULL,$3) AS id", [projectId, revision, people],
  );
  const finish = (id, revision, status) => db.query('SELECT atualizar_conclusao_contrato_pj($1,$2,$3)', [id, revision, status]);
  const projects = () => db.query('SELECT id, versao, concluido_por FROM contratos_pj ORDER BY id');
  const assignments = () => db.query('SELECT funcionario_id FROM contratos_pj_participantes ORDER BY funcionario_id');
  let sharedProject;
  let otherProject;

  await t.test('an administrator creates shared projects and assigns one worker to more than one', async () => {
    for (const actor of [null, member, inactive]) {
      await assert.rejects(as(actor, () => save([member])), /permission denied|restrita/);
    }
    for (const invalid of [[clt], [inactive], [null]]) {
      await assert.rejects(as(admin, () => save(invalid)), /funcionários PJ ativos|participantes válidos/);
    }
    sharedProject = (await as(admin, () => save([member, teammate]))).rows[0].id;
    otherProject = (await as(admin, () => save([member]))).rows[0].id;
    assert.equal((await as(member, projects)).rows.length, 2);
    assert.deepEqual((await as(teammate, projects)).rows.map(({ id }) => id), [sharedProject]);
    assert.deepEqual((await as(teammate, assignments)).rows, [{ funcionario_id: teammate }]);
    for (const actor of [outsider, clt, inactive]) assert.deepEqual((await as(actor, projects)).rows, []);
    await assert.rejects(as(null, projects), /permission denied/);
  });

  await t.test('an assigned PJ or administrator can conclude, with audit and safe reopens', async () => {
    await assert.rejects(as(outsider, () => finish(sharedProject, 1, true)), /não tem acesso/);
    await assert.rejects(as(member, () => db.exec("UPDATE contratos_pj SET nome = 'Alterado'")), /permission denied/);
    await as(member, () => finish(sharedProject, 1, true));
    await as(teammate, () => finish(sharedProject, 1, true));
    assert.deepEqual((await as(teammate, projects)).rows[0], { id: sharedProject, versao: 2, concluido_por: member });
    await assert.rejects(as(member, () => finish(sharedProject, 2, false)), /não tem acesso/);
    await assert.rejects(as(admin, () => save([member], sharedProject, 2)), /Reabra o projeto/);
    await as(admin, () => finish(sharedProject, 2, false));
    await assert.rejects(as(member, () => finish(sharedProject, 1, true)), /foi atualizado/);
    await as(admin, () => finish(sharedProject, 3, true));
    assert.equal((await as(teammate, projects)).rows[0].concluido_por, admin);
    const audit = (await db.query("SELECT admin_id, detalhes->>'ator_nome' AS ator FROM auditoria WHERE acao='concluir_contrato_pj'")).rows;
    assert.deepEqual(audit, [{ admin_id: null, ator: 'Prestador A' }, { admin_id: admin, ator: 'Admin' }]);
  });

  await t.test('editing memberships is atomic and revokes access when an assignment is removed', async () => {
    await as(admin, () => save([outsider], otherProject, 1));
    await assert.rejects(as(admin, () => save([member], otherProject, 1)), /foi atualizado/);
    assert.equal((await as(outsider, projects)).rows[0].id, otherProject);
    assert.deepEqual((await as(member, projects)).rows.map(({ id }) => id), [sharedProject]);
    await assert.rejects(as(member, () => finish(otherProject, 2, true)), /não tem acesso/);
  });

  await t.test('the download timestamp and rows come from one query under punch RLS', async () => {
    await db.query("INSERT INTO registros_ponto VALUES (gen_random_uuid(), $1, '2026-11-16', '09:00', NULL)", [member]);
    const report = () => db.query("SELECT get_timesheet_report($1,'2026-11-16','2026-11-16') AS relatorio", [member]);
    const own = (await as(member, report)).rows[0].relatorio;
    assert.ok(Number.isFinite(Date.parse(own.emitido_em)));
    assert.equal(own.registros[0].entrada, '09:00:00');
    assert.equal((await as(admin, report)).rows[0].relatorio.registros.length, 1);
    assert.deepEqual((await as(teammate, report)).rows[0].relatorio.registros, []);
    await assert.rejects(as(null, report), /permission denied/);
  });
});
