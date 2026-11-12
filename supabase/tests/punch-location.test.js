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
      CREATE SCHEMA private;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE TABLE funcionarios(id uuid PRIMARY KEY, auth_id uuid UNIQUE, ativo boolean, role text, tipo_contrato text, escala_trabalho jsonb, data_admissao date);
      CREATE TABLE registros_ponto(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), funcionario_id uuid REFERENCES funcionarios,
        data date, entrada time, saida_almoco time, retorno_almoco time, saida time, saida_data date, turno_trabalhado text,
        created_at timestamptz DEFAULT now(), UNIQUE(funcionario_id, data));
      CREATE TABLE auditoria(acao text, alvo_id uuid, detalhes jsonb);
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=auth.uid() AND role='admin' AND ativo=true)$$;
      ALTER TABLE registros_ponto ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON registros_ponto, funcionarios TO authenticated;
      CREATE POLICY own_record ON registros_ponto FOR SELECT TO authenticated USING (
        funcionario_id IN (SELECT id FROM funcionarios WHERE auth_id=auth.uid() AND ativo=true) OR public.is_admin());
    `);
    const source = await readFile(new URL('../migrations/20261030174501_work_schedules_and_historical_punches.sql', import.meta.url), 'utf8');
    for (const name of ['kairopont_infer_shift', 'kairopont_infer_employee_schedule', 'registrar_ponto', 'prevent_late_punch_record_changes']) {
      const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      await db.exec(source.slice(start, source.indexOf('$$;', start) + 3));
    }
    await db.exec(`CREATE TRIGGER prevent_late_punch_record_changes
      BEFORE UPDATE OR DELETE ON registros_ponto FOR EACH ROW EXECUTE FUNCTION public.prevent_late_punch_record_changes();`);
    await db.exec('REVOKE ALL ON FUNCTION registrar_ponto(uuid,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION registrar_ponto(uuid,text) TO authenticated;');
    await db.exec(await readFile(new URL('../migrations/20261110164734_punch_location_sharing.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../migrations/20261112113641_async_punch_location.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../migrations/20261112115139_offline_punch_sync.sql', import.meta.url), 'utf8'));
    for (const [id, role, active] of [[employee, 'employee', true], [other, 'employee', true], [admin, 'admin', true], [inactive, 'employee', false]]) {
      await db.query('INSERT INTO funcionarios(id,auth_id,ativo,role,tipo_contrato) VALUES($1,$1,$2,$3,$4)', [id, active, role, 'pj']);
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
    const captureId = '20000000-0000-0000-0000-000000000001';
    const startCapture = async (type, token = captureId) =>
      (await db.query('SELECT registrar_ponto($1,$2,NULL,$3) AS id', [employee, type, token])).rows[0].id;
    const finishCapture = async (id, type, data = location, token = captureId) =>
      (await db.query('SELECT finalizar_localizacao_ponto($1,$2,$3,$4) AS location', [id, type, token, data])).rows[0].location;
    const offline = async (id, field, shift, occurred, position = null) => (
      await db.query('SELECT sincronizar_marcacao_ponto($1,$2,$3,$4,$5,$6) AS result', [employee, id, field, shift, occurred, position])
    ).rows[0].result;
    const exitId = '20000000-0000-0000-0000-000000000002';

    await t.test('offline punches retain device time, close overnight shifts and safely replay with late coordinates', async () => {
      await as(employee, async () => {
        const { entry, exit } = (await db.query(`SELECT
          (current_date - 10 + time '22:01') AT TIME ZONE 'America/Sao_Paulo' AS entry,
          (current_date - 9 + time '05:02') AT TIME ZONE 'America/Sao_Paulo' AS exit`)).rows[0];
        const pending = await offline(captureId, 'entrada', captureId, entry);
        assert.equal(pending.registro.entrada, '22:01:00');
        assert.equal(pending.localizacao_finalizada, false);
        const saved = await offline(exitId, 'saida', captureId, exit, { status: 'timeout' });
        assert.equal(saved.registro.saida, '05:02:00');
        assert.ok(saved.registro.saida_data > saved.registro.data);
        assert.equal(saved.registro.saida_localizacao.status, 'timeout');
        const replay = await offline(captureId, 'entrada', captureId, null, location);
        assert.equal(replay.registro.id, captureId);
        assert.equal(replay.registro.entrada, '22:01:00');
        assert.equal(replay.registro.entrada_localizacao.latitude, location.latitude);
        assert.equal((await offline(captureId, 'entrada', captureId, entry, { status: 'denied' })).registro.entrada_localizacao.status, 'captured');
        assert.equal((await records()).length, 1);
        await db.exec('RESET ROLE');
        const audit = (await db.query("SELECT detalhes FROM auditoria WHERE acao = 'ponto_offline_sincronizado'")).rows;
        assert.equal(audit.length, 2);
        assert.ok(audit.every(({ detalhes }) => Date.parse(detalhes.horario_aparelho) < Date.parse(detalhes.recebido_em)));
      });
    });
    await t.test('offline submissions cannot use a different owner, a different open shift or a future clock', async () => {
      await as(other, () => assert.rejects(offline(captureId, 'entrada', captureId, null), /inválido ou inativo/));
      await as(null, () => assert.rejects(offline(captureId, 'entrada', captureId, null), /permission denied/), 'anon');
      await as(employee, () => assert.rejects(offline(captureId, 'entrada', captureId, '2099-01-01T11:00:00Z'), /marcação está no futuro/));
      await as(employee, async () => {
        await offline(captureId, 'entrada', captureId, null);
        await assert.rejects(offline(exitId, 'saida', employee, null), /jornada mudou/i);
      });
    });
    await t.test('a location payload cannot discard a queued punch and a correction still clears pending coordinates', async () => {
      await as(employee, async () => {
        const saved = await offline(captureId, 'entrada', captureId, null, { ...location, accuracy: -1 });
        assert.equal(saved.registro.entrada_localizacao.status, 'unavailable');
        assert.ok(saved.registro.entrada);
      });
      await as(employee, async () => {
        await offline(captureId, 'entrada', captureId, null);
        await db.exec('RESET ROLE');
        await db.exec("UPDATE registros_ponto SET entrada = entrada + interval '1 second'");
        await db.exec('SET LOCAL ROLE authenticated');
        const saved = await offline(captureId, 'entrada', captureId, null, location);
        assert.equal(saved.localizacao_finalizada, true);
        assert.equal(saved.registro.entrada_localizacao.status, 'adjusted');
      });
    });
    await t.test('an old offline exit can complete the original shift after the ordinary edit window', async () => {
      await as(employee, async () => {
        await db.exec('RESET ROLE');
        const date = (await db.query('SELECT (current_date - 8)::text AS date')).rows[0].date;
        await db.query(`INSERT INTO registros_ponto (id,funcionario_id,data,entrada,created_at)
          VALUES ($1,$2,$3,'08:00',now() - interval '8 days')`, [captureId, employee, date]);
        await db.exec('SET LOCAL ROLE authenticated');
        const readEditFlag = async () => (await db.query("SELECT current_setting('kairopont.allow_historical_punch_edit', true) AS flag")).rows[0].flag;
        const previous = await readEditFlag();
        const saved = await offline(exitId, 'saida', captureId, `${date}T17:00:00-03:00`, location);
        assert.equal(saved.registro.entrada, '08:00:00');
        assert.equal(saved.registro.saida, '17:00:00');
        assert.equal(await readEditFlag(), previous ?? 'off');
      });
    });

    await t.test('the official punch exists before coordinates arrive, with one result per marking', async () => {
      await as(employee, async () => {
        const id = await startCapture('entrada');
        const [pending] = await records();
        assert.equal(pending.id, id);
        assert.ok(pending.entrada);
        assert.equal(pending.entrada_localizacao.captura_id, captureId);
        assert.equal(await finishCapture(id, 'saida'), null);
        const saved = await finishCapture(id, 'entrada');
        assert.equal(saved.latitude, location.latitude);
        assert.equal(saved.captura_id, undefined);
        assert.equal(saved.secret, undefined);
        assert.equal(await finishCapture(id, 'entrada', { status: 'timeout' }), null);
        assert.equal(await startCapture('saida'), id);
        assert.equal((await finishCapture(id, 'saida', { status: 'timeout' })).status, 'timeout');
        const [final] = await records();
        assert.equal(final.entrada, pending.entrada);
        assert.deepEqual(final.entrada_localizacao, saved);
        assert.equal(final.saida_localizacao.status, 'timeout');
      });
    });

    await t.test('a capture cannot cross employee, expiry or administrative correction boundaries', async () => {
      await as(employee, async () => {
        const id = await startCapture('entrada');
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [other]);
        assert.equal(await finishCapture(id, 'entrada'), null);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [employee]);
        assert.equal(await finishCapture(id, 'entrada', location, other), null);
        await db.exec('RESET ROLE');
        await db.exec("UPDATE registros_ponto SET entrada_localizacao = entrada_localizacao || jsonb_build_object('recorded_at', now() - interval '3 minutes')");
        await db.exec('SET LOCAL ROLE authenticated');
        assert.equal(await finishCapture(id, 'entrada'), null);
        await db.exec('RESET ROLE');
        await db.exec("UPDATE registros_ponto SET entrada = entrada + interval '1 second'");
        await db.exec('SET LOCAL ROLE authenticated');
        assert.equal(await finishCapture(id, 'entrada'), null);
        assert.deepEqual((await records())[0].entrada_localizacao, { status: 'adjusted' });
      });
      await as(null, () => assert.rejects(finishCapture(employee, 'entrada'), /permission denied/), 'anon');
    });

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
