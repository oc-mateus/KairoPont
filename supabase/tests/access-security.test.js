import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('access changes reject null values and preserve administrative safeguards', async (t) => {
  const db = new PGlite();
  const admin = '10000000-0000-0000-0000-000000000001';
  const employee = '10000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA public,auth TO authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE TABLE funcionarios(id uuid PRIMARY KEY,auth_id uuid,role text,ativo boolean,tipo_contrato text,data_admissao date,escala_trabalho jsonb);
      CREATE TABLE auditoria(admin_id uuid,acao text,alvo_id uuid,detalhes jsonb);
      CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=auth.uid() AND role='admin' AND ativo=true)$$;
      CREATE FUNCTION kairopont_today_sp() RETURNS date LANGUAGE sql AS $$SELECT current_date$$;
      CREATE FUNCTION admin_update_employee_employment(uuid,date,jsonb) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
      GRANT SELECT ON funcionarios,auditoria TO authenticated;`);
    await db.exec(await readFile(new URL('../migrations/20261110175945_reject_null_employee_access.sql', import.meta.url), 'utf8'));
    await db.query("INSERT INTO funcionarios VALUES($1,$1,'admin',true,'clt',current_date,'{}'),($2,$2,'employee',true,'clt',current_date,'{}')", [admin,employee]);
    async function as(actor, callback) {
      await db.exec('BEGIN');
      try {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);
        await db.exec('SET LOCAL ROLE authenticated');
        return await callback();
      } finally { await db.exec('ROLLBACK'); }
    }
    const update = (target,active,role) => db.query('SELECT admin_update_employee($1,$2,$3)',[target,active,role]);
    await t.test('NULL role cannot bypass self-demotion or status checks', async () => {
      for (const [target,active,role] of [[admin,true,null],[employee,null,'employee'],[null,true,'admin'],[employee,true,'invalid']]) {
        await as(admin,()=>assert.rejects(update(target,active,role),/status e perfil válidos/));
        assert.equal((await db.query('SELECT role FROM funcionarios WHERE id=$1',[admin])).rows[0].role,'admin');
      }
    });
    await t.test('ordinary employees cannot grant access and admins cannot demote themselves', async () => {
      await as(employee,()=>assert.rejects(update(employee,true,'admin'),/restrita a administradores/));
      await as(admin,()=>assert.rejects(update(admin,true,'employee'),/própria conta/));
      await as(admin,()=>assert.rejects(update(admin,false,'admin'),/própria conta/));
    });
    await t.test('valid administrative updates remain available and audited', async () => {
      await as(admin,async()=>{
        await update(employee,false,'employee');
        assert.equal((await db.query('SELECT ativo FROM funcionarios WHERE id=$1',[employee])).rows[0].ativo,false);
        assert.equal((await db.query('SELECT count(*) AS n FROM auditoria')).rows[0].n,1);
      });
    });
    await t.test('legacy contract endpoint rejects NULL instead of silently converting CLT to PJ', async () => {
      await as(admin,()=>assert.rejects(db.query('SELECT admin_update_employee_employment($1,null,null,null)',[employee]),/vínculo inválido/));
      assert.equal((await db.query('SELECT tipo_contrato FROM funcionarios WHERE id=$1',[employee])).rows[0].tipo_contrato,'clt');
    });
  } finally { await db.close(); }
});
