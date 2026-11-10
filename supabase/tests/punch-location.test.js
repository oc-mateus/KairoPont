import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('punch location is atomic, scoped to the employee and supports overnight shifts', async (t) => {
  const db = new PGlite();
  const employee = '10000000-0000-0000-0000-000000000001';
  const other = '10000000-0000-0000-0000-000000000002';
  const admin = '10000000-0000-0000-0000-000000000003';
  const inactive = '10000000-0000-0000-0000-000000000004';
  const location = { status: 'captured', latitude: -23.55052, longitude: -46.633308, accuracy: 15, secret: 'discard', recorded_at: '1900-01-01' };
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE TABLE funcionarios(id uuid PRIMARY KEY, auth_id uuid UNIQUE, ativo boolean, role text, tipo_contrato text, escala_trabalho jsonb);
      CREATE TABLE registros_ponto(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), funcionario_id uuid REFERENCES funcionarios,
        data date, entrada time, saida_almoco time, retorno_almoco time, saida time, saida_data date, turno_trabalhado text,
        created_at timestamptz DEFAULT now(), UNIQUE(funcionario_id, data));
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=auth.uid() AND role='admin' AND ativo=true)$$;
      ALTER TABLE registros_ponto ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON registros_ponto, funcionarios TO authenticated;
      CREATE POLICY own_record ON registros_ponto FOR SELECT TO authenticated USING (
        funcionario_id IN (SELECT id FROM funcionarios WHERE auth_id=auth.uid() AND ativo=true) OR public.is_admin());
    `);
    const source = await readFile(new URL('../migrations/20261030174501_work_schedules_and_historical_punches.sql', import.meta.url), 'utf8');
    for (const name of ['kairopont_infer_shift', 'kairopont_infer_employee_schedule', 'registrar_ponto']) {
      const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      await db.exec(source.slice(start, source.indexOf('$$;', start) + 3));
    }
    await db.exec('REVOKE ALL ON FUNCTION registrar_ponto(uuid,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION registrar_ponto(uuid,text) TO authenticated;');
    await db.exec(await readFile(new URL('../migrations/20261110164734_punch_location_sharing.sql', import.meta.url), 'utf8'));
    for (const [id, role, active] of [[employee, 'employee', true], [other, 'employee', true], [admin, 'admin', true], [inactive, 'employee', false]]) {
      await db.query('INSERT INTO funcionarios VALUES($1,$1,$2,$3,$4,null)', [id, active, role, 'pj']);
    }
    async function as(actor, callback, role = 'authenticated') {
      await db.exec('BEGIN');
      try {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor || '']);
        await db.exec(`SET LOCAL ROLE ${role}`);
        return await callback();
      } finally { await db.exec('ROLLBACK'); }
    }
    const punch = (id, type, data = location) => db.query('SELECT registrar_ponto($1,$2,$3::jsonb)', [id, type, data]);
    const records = async () => (await db.query('SELECT * FROM registros_ponto ORDER BY data')).rows;
    await t.test('anonymous, inactive and other employees cannot punch for an employee', async () => {
      await as(null, () => assert.rejects(punch(employee, 'entrada'), /permission denied/), 'anon');
      await as(other, () => assert.rejects(punch(employee, 'entrada'), /inválido ou inativo/));
      await as(inactive, () => assert.rejects(punch(inactive, 'entrada'), /inválido ou inativo/));
    });
    await t.test('entry and exit persist distinct readings with server time and discard arbitrary metadata', async () => {
      await as(employee, async () => {
        await punch(employee, 'entrada');
        await punch(employee, 'saida', { ...location, latitude: 0, longitude: 0 });
        const [record] = await records();
        assert.equal(record.entrada_localizacao.latitude, location.latitude);
        assert.equal(record.saida_localizacao.latitude, 0);
        assert.equal(record.entrada_localizacao.accuracy, 15);
        assert.equal(record.entrada_localizacao.secret, undefined);
        assert.notEqual(record.entrada_localizacao.recorded_at, location.recorded_at);
        const clock = (await db.query("SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::time AS value")).rows[0].value;
        assert.equal(record.entrada, clock);
        assert.equal(record.saida, clock);
      });
    });
    await t.test('all failure states still save punches without client coordinates', async () => {
      for (const status of ['denied', 'timeout', 'unsupported', 'unavailable', 'not_collected']) {
        await as(employee, async () => {
          await punch(employee, 'entrada', { ...location, status });
          const [record] = await records();
          assert.equal(record.entrada_localizacao.status, status);
          assert.equal(record.entrada_localizacao.latitude, undefined);
        });
      }
    });
    await t.test('invalid location input rolls back without a partial punch', async () => {
      for (const invalid of [{ ...location, latitude: 91 }, { ...location, longitude: -181 }, { ...location, accuracy: -1 }, { status: 'captured' }, { ...location, latitude: '23' }, [], { status: 'invented' }]) {
        await as(employee, () => assert.rejects(punch(employee, 'entrada', invalid)));
        assert.equal((await records()).length, 0);
      }
    });
    await t.test('failure in the existing punch validation cannot leave location data behind', async () => {
      await as(employee, async () => {
        await punch(employee, 'entrada');
        await assert.rejects(punch(employee, 'entrada'), /Já existe/);
      });
      assert.equal((await records()).length, 0);
      await as(employee, () => assert.rejects(punch(employee, 'saida'), /Não há jornada/));
    });
    await t.test('yesterday CLT night shift and PJ shift receive exit location on their original row', async () => {
      for (const contract of ['pj', 'clt']) {
        await db.query('UPDATE funcionarios SET tipo_contrato=$1 WHERE id=$2', [contract, employee]);
        await db.query("INSERT INTO registros_ponto(funcionario_id,data,entrada,turno_trabalhado) VALUES($1,(now() AT TIME ZONE 'America/Sao_Paulo')::date-1,'22:00','turno3')", [employee]);
        // CLT fixture has a completed one-hour break even on a weekend.
        await db.exec("UPDATE registros_ponto SET saida_almoco='23:00',retorno_almoco='00:00'");
        await as(employee, async () => {
          await punch(employee, 'saida');
          const [record] = await records();
          assert.equal(record.saida_localizacao.status, 'captured');
          assert.ok(record.saida_data > record.data);
          assert.equal((await records()).length, 1);
        });
        await db.exec('DELETE FROM registros_ponto');
      }
    });
    await t.test('RLS isolates coordinates and direct writes remain forbidden', async () => {
      await db.query("INSERT INTO registros_ponto(funcionario_id,data,entrada,entrada_localizacao) VALUES($1,current_date,'08:00',$2)", [employee, location]);
      await as(other, async () => { assert.equal((await records()).length, 0); });
      await as(inactive, async () => { assert.equal((await records()).length, 0); });
      await as(admin, async () => { assert.equal((await records()).length, 1); });
      await as(employee, () => assert.rejects(db.query("UPDATE registros_ponto SET entrada_localizacao='{}'"), /permission denied/));
    });
    await t.test('administrative time corrections invalidate only the corresponding original location', async () => {
      await db.query("UPDATE registros_ponto SET saida='17:00',saida_data=data,saida_localizacao=$1", [location]);
      await db.exec("UPDATE registros_ponto SET entrada='09:00'");
      let [record] = await records();
      assert.deepEqual(record.entrada_localizacao, { status: 'adjusted' });
      assert.equal(record.saida_localizacao.status, 'captured');
      await db.exec("UPDATE registros_ponto SET saida='18:00'");
      [record] = await records();
      assert.deepEqual(record.saida_localizacao, { status: 'adjusted' });
    });
  } finally { await db.close(); }
});
