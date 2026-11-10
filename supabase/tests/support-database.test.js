import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('support database permissions, idempotency and quotas in local PostgreSQL', async (t) => {
  const db = new PGlite();
  const owner = (await db.query('select current_user as name')).rows[0].name;
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.funcionarios(id uuid PRIMARY KEY,auth_id uuid UNIQUE,nome text,email text,role text,ativo boolean);
    CREATE TABLE public.auditoria(admin_id uuid,acao text,alvo_id uuid,detalhes jsonb);
    CREATE TABLE private.edge_rate_limits(action text,subject text,window_seconds integer,window_started_at timestamptz,requests integer,PRIMARY KEY(action,subject,window_seconds));
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=auth.uid() AND role='admin' AND ativo=true)$$;
    ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.funcionarios TO authenticated;
    CREATE POLICY employee_read ON public.funcionarios FOR SELECT TO authenticated USING(auth_id=auth.uid() OR public.is_admin());
  `);
  const migration = await readFile(new URL('../migrations/20261108044641_support_center_and_private_ticket_queue.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  for (const filename of ['20261110140710_support_account_access.sql','20261110140712_enforce_support_ticket_access.sql']) await db.exec(await readFile(new URL(`../migrations/${filename}`,import.meta.url),'utf8'));
  const ids = ['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000005'];
  for (let index = 0; index < ids.length; index++) {
    await db.query('insert into funcionarios(id,auth_id,nome,email,role,ativo,suporte) values($1,$1,$2,$3,$4,$5,$6)', [ids[index], `Test ${index}`, `test${index}@example.invalid`, [2,4].includes(index) ? 'admin' : 'employee', index !== 3, [1,2,3].includes(index)]);
  }
  const fixture = (await db.query("insert into support_tickets(funcionario_id,request_id,category,subject,description) values($1,gen_random_uuid(),'acesso','Test ticket','Description for local testing') returning id", [ids[0]])).rows[0];
  await db.query("insert into support_tickets(funcionario_id,request_id,category,subject,description) values($1,gen_random_uuid(),'ponto','Other ticket','Description for another employee')", [ids[1]]);
  async function as(role, id, callback) {
    await db.exec('BEGIN');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id || '']);
      await db.exec(`SET LOCAL ROLE ${role}`);
      return await callback();
    } finally { await db.exec('ROLLBACK'); }
  }
  try {
    await t.test('anonymous clients cannot read, create or claim mail', async () => {
      await as('anon', null, async () => assert.rejects(db.query('select * from support_tickets'), /permission denied/));
      await as('anon', null, async () => assert.rejects(db.query("select create_support_ticket(gen_random_uuid(),'acesso','subject','description longer')"), /permission denied/));
      await as('authenticated', ids[0], async () => assert.rejects(db.query('select claim_support_email($1)', [fixture.id]), /permission denied/));
    });
    await t.test('employees only see their own tickets and cannot mass assign status', async () => {
      await as('authenticated', ids[0], async () => {
        const rows = (await db.query('select * from support_tickets')).rows;
        assert.equal(rows.length, 1); assert.equal(rows[0].funcionario_id, ids[0]);
        await assert.rejects(db.query("update support_tickets set status='respondido',response='forged'"), /permission denied/);
      });
    });
    await t.test('inactive employees lose ticket access and cannot submit', async () => {
      await as('authenticated', ids[3], async () => {
        assert.equal((await db.query('select * from support_tickets')).rows.length, 0);
        await assert.rejects(db.query("select create_support_ticket(gen_random_uuid(),'acesso','subject','description longer')"), /Conta ativa/);
      });
    });
    await t.test('ticket retries return the same row and consume one quota', async () => {
      await as('authenticated', ids[0], async () => {
        const requestId = '20000000-0000-0000-0000-000000000001';
        const query = "select * from create_support_ticket($1,'acesso','Subject','Description with enough detail')";
        const first = (await db.query(query, [requestId])).rows[0];
        const second = (await db.query(query, [requestId])).rows[0];
        assert.equal(first.id, second.id); assert.equal(first.funcionario_id, ids[0]);
        assert.equal((await db.query('select * from support_tickets')).rows.length, 2);
      });
    });
    await t.test('fourth hourly ticket is blocked by the database', async () => {
      await as('authenticated', ids[0], async () => {
        for (let i = 0; i < 3; i++) await db.query("select * from create_support_ticket(gen_random_uuid(),'ponto','Subject','Description with enough detail')");
        await assert.rejects(db.query("select * from create_support_ticket(gen_random_uuid(),'ponto','Subject','Description with enough detail')"), /Limite de chamados/);
      });
    });
    await t.test('employees cannot respond or run server-only quota RPCs', async () => {
      await as('authenticated', ids[0], async () => assert.rejects(db.query("select support_update_ticket_status($1,'respondido')", [fixture.id]), /Acesso ao suporte/));
      await as('authenticated', ids[0], async () => assert.rejects(db.query("select consume_support_quota('support-question',$1)", [ids[0]]), /permission denied/));
    });
    await t.test('support status update is audited without storing a portal reply', async () => {
      await as('authenticated', ids[2], async () => {
        assert.equal((await db.query('select * from support_tickets')).rows.length, 2);
        const result = (await db.query("select * from support_update_ticket_status($1,'respondido')", [fixture.id])).rows[0];
        assert.equal(result.responded_by, ids[2]); assert.equal(result.status, 'respondido');
        assert.equal(result.response,null);
        await db.exec(`SET LOCAL ROLE ${owner}`);
        assert.equal((await db.query('select * from auditoria')).rows.length, 1);
      });
    });
    await t.test('support staff can read requester contacts and respond without becoming admins', async () => {
      await as('authenticated', ids[1], async () => {
        assert.equal((await db.query('select is_admin() as admin')).rows[0].admin,false);
        assert.equal((await db.query('select is_support() as support')).rows[0].support,true);
        assert.equal((await db.query('select * from funcionarios')).rows.length,1);
        const tickets=(await db.query("select list_support_tickets('todos',0) as ticket")).rows;
        assert.equal(tickets.length,2);
        assert.deepEqual(tickets.find(row=>row.ticket.id===fixture.id).ticket.employee,{nome:'Test 0',email:'test0@example.invalid'});
        const result=(await db.query("select * from support_update_ticket_status($1,'respondido')",[fixture.id])).rows[0];
        assert.equal(result.responded_by,ids[1]);
        assert.equal('response' in tickets[0].ticket,false);
      });
    });
    await t.test('admin without support and inactive support cannot list the queue or respond', async () => {
      for(const id of [ids[4],ids[3]]) {
        await as('authenticated',id,()=>assert.rejects(db.query("select list_support_tickets('todos',0)"),/Acesso ao suporte/));
        await as('authenticated',id,()=>assert.rejects(db.query("select support_update_ticket_status($1,'respondido')",[fixture.id]),/Acesso ao suporte/));
      }
      await as('authenticated',ids[0],()=>assert.rejects(db.query('update funcionarios set suporte=true where id=$1',[ids[0]]),/permission denied/));
      await as('anon',null,()=>assert.rejects(db.query("select list_support_tickets('todos',0)"),/permission denied/));
      await as('authenticated',ids[1],()=>assert.rejects(db.query("select admin_respond_support_ticket($1,'Resposta antiga','respondido')",[fixture.id]),/permission denied/));
    });
    await t.test('AI quota blocks the sixth request and is shared project-wide', async () => {
      await as('service_role', null, async () => {
        for (let i = 0; i < 5; i++) assert.equal((await db.query("select consume_support_quota('support-question',$1) as quota", [ids[0]])).rows[0].quota.allowed, true);
        const denied = (await db.query("select consume_support_quota('support-question',$1) as quota", [ids[0]])).rows[0].quota;
        assert.equal(denied.allowed, false); assert.ok(denied.retry_after > 0);
        await db.exec(`SET LOCAL ROLE ${owner}`);
        await db.exec("update private.edge_rate_limits set requests=200 where action='support-question' and subject='project'");
        await db.exec('SET LOCAL ROLE service_role');
        assert.equal((await db.query("select consume_support_quota('support-question',$1) as quota", [ids[1]])).rows[0].quota.allowed, false);
      });
    });
    await t.test('mail claims exclude concurrent sends and successful replays', async () => {
      await as('service_role', null, async () => {
        assert.equal((await db.query('select claim_support_email($1) as claimed', [fixture.id])).rows[0].claimed, true);
        assert.equal((await db.query('select claim_support_email($1) as claimed', [fixture.id])).rows[0].claimed, false);
        await db.query('select finish_support_email($1,true)', [fixture.id]);
        assert.equal((await db.query('select claim_support_email($1) as claimed', [fixture.id])).rows[0].claimed, false);
      });
    });
    await t.test('old uncertain mail attempts require manual review', async () => {
      await as(owner, null, async () => {
        await db.query("insert into private.support_email_delivery(ticket_id,state,attempts,attempted_at,first_attempt_at) values($1,'failed',1,now()-interval '24 hours',now()-interval '24 hours')", [fixture.id]);
        await db.exec('SET LOCAL ROLE service_role');
        assert.equal((await db.query('select claim_support_email($1) as claimed', [fixture.id])).rows[0].claimed, false);
      });
    });
  } finally { await db.close(); }
});
