import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('administrative registration edits preserve identity and audit atomic changes', async (t) => {
  const db = new PGlite();
  const admin = '10000000-0000-0000-0000-000000000001';
  const employee = '10000000-0000-0000-0000-000000000002';
  const inactiveAdmin = '10000000-0000-0000-0000-000000000003';
  const schedule = { turno_id: 'turno1', dias_semana: [1,2,3,4,5,6], horarios_habituais: [{ id: 'turno1', entrada: '06:00', saida: '15:00' }], contabilizar_atrasos: false };
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE TABLE public.funcionarios(id uuid PRIMARY KEY,auth_id uuid UNIQUE,nome text,cargo text,role text,ativo boolean,tipo_contrato text,data_admissao date,escala_trabalho jsonb,cpf text,email text);
      CREATE TABLE public.auditoria(admin_id uuid,acao text,alvo_id uuid,detalhes jsonb,created_at timestamptz);
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=auth.uid() AND role='admin' AND ativo=true)$$;
      CREATE FUNCTION public.kairopont_today_sp() RETURNS date LANGUAGE sql STABLE AS $$SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date$$;
      ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.funcionarios,public.auditoria TO authenticated;
      CREATE POLICY employee_read ON public.funcionarios FOR SELECT TO authenticated USING(auth_id=auth.uid() OR public.is_admin());
    `);
    // Load the same validation functions that the production migration reuses.
    for (const filename of ['20261030181845_habitual_employee_schedules.sql', '20261015210151_enforce_active_employee_access_and_sp_dates.sql']) {
      const source = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
      const start = source.indexOf('CREATE OR REPLACE FUNCTION public.admin_update_employee_employment(');
      await db.exec(source.slice(start, source.indexOf('$$;', start) + 3));
    }
    await db.exec(await readFile(new URL('../migrations/20261110125841_admin_employee_details.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../migrations/20261110140710_support_account_access.sql', import.meta.url), 'utf8'));
    for (const [id, role, active] of [[admin, 'admin', true], [employee, 'employee', true], [inactiveAdmin, 'admin', false]]) {
      await db.query('insert into funcionarios values($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, 'Pessoa original', 'Assistente', role, active, 'clt', '2026-01-02', schedule, `cpf-${id}`, `${id}@example.invalid`]);
    }
    async function as(role, actor, callback) {
      await db.exec('BEGIN');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor || '']);
        await db.exec(`SET LOCAL ROLE ${role}`);
        return await callback();
      } finally { await db.exec('ROLLBACK'); }
    }
    const save = (overrides = {}) => {
      const values = { id: employee, name: '  Pessoa atualizada  ', job: '  Analista  ', admission: '2026-01-02', schedule, contract: 'clt', ...overrides };
      return db.query('select admin_update_employee_details($1,$2,$3,$4,$5,$6) as employee', Object.values(values));
    };
    await t.test('anonymous, employee and inactive admin cannot edit registrations', async () => {
      for (const [role, actor] of [['anon', null], ['authenticated', employee], ['authenticated', inactiveAdmin]]) {
        await as(role, actor, () => assert.rejects(save(), /permission denied|restrita a administradores/));
      }
    });
    await t.test('admin updates name and job without changing identity or access', async () => {
      await as('authenticated', admin, async () => {
        const updated = (await save()).rows[0].employee;
        assert.equal(updated.nome, 'Pessoa atualizada');
        assert.equal(updated.cargo, 'Analista');
        assert.equal(updated.auth_id, employee);
        assert.equal(updated.cpf, `cpf-${employee}`);
        assert.equal(updated.email, `${employee}@example.invalid`);
        assert.equal(updated.role, 'employee');
        assert.equal(updated.ativo, true);
        assert.equal(updated.escala_trabalho.contabilizar_atrasos, false);
        const audit = (await db.query('select * from auditoria')).rows[0];
        assert.equal(audit.admin_id, admin);
        assert.equal(audit.alvo_id, employee);
        assert.equal(audit.detalhes.antes.cargo, 'Assistente');
        assert.equal(audit.detalhes.depois.cargo, 'Analista');
      });
    });
    await t.test('CLT to PJ clears schedule and PJ to CLT restores required schedule', async () => {
      await as('authenticated', admin, async () => {
        const pj = (await save({ contract: 'pj', schedule: null, admission: null })).rows[0].employee;
        assert.equal(pj.tipo_contrato, 'pj');
        assert.equal(pj.escala_trabalho, null);
        assert.equal(pj.data_admissao, null);
        const clt = (await save()).rows[0].employee;
        assert.equal(clt.tipo_contrato, 'clt');
        assert.deepEqual(clt.escala_trabalho, schedule);
        assert.equal((await db.query('select * from auditoria')).rows.length, 2);
      });
    });
    await t.test('invalid input and unknown employees fail without partial changes', async () => {
      for (const overrides of [{ name: '   ' }, { name: null }, { job: ' ' }, { contract: null }, { contract: 'outro' }, { admission: '2999-01-01' }, { admission: null }, { schedule: null }, { schedule: {} }, { id: '20000000-0000-0000-0000-000000000001' }]) {
        await as('authenticated', admin, () => assert.rejects(save(overrides)));
        assert.equal((await db.query('select cargo from funcionarios where id=$1', [employee])).rows[0].cargo, 'Assistente');
        assert.equal((await db.query('select * from auditoria')).rows.length, 0);
      }
    });
    await t.test('audit failure rolls back every registration change', async () => {
      await db.exec("ALTER TABLE auditoria ADD CONSTRAINT reject_test_audit CHECK (acao <> 'atualizar_cadastro_funcionario')");
      await as('authenticated', admin, () => assert.rejects(save({ contract: 'pj', schedule: null }), /reject_test_audit/));
      const original = (await db.query('select * from funcionarios where id=$1', [employee])).rows[0];
      assert.equal(original.tipo_contrato, 'clt');
      assert.equal(original.cargo, 'Assistente');
    });
    await db.exec('ALTER TABLE auditoria DROP CONSTRAINT reject_test_audit');
    await t.test('only admins grant independent support access through the audited editor',async()=>{
      const args=[employee,'Pessoa atualizada','Analista','2026-01-02',schedule,'clt',true];
      const query='select admin_update_employee_details($1,$2,$3,$4,$5,$6,$7) as employee';
      await as('authenticated',employee,()=>assert.rejects(db.query(query,args),/restrita a administradores/));
      await as('authenticated',admin,async()=>{
        const result=(await db.query(query,args)).rows[0].employee;
        assert.equal(result.suporte,true);
        assert.equal(result.role,'employee');
        const audit=(await db.query("select * from auditoria where acao='alterar_acesso_suporte'")).rows[0];
        assert.deepEqual(audit.detalhes,{antes:false,depois:true});
      });
    });
  } finally { await db.close(); }
});
