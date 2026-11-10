-- Authorized production verification. Temporary identities are never issued
-- sessions. No email, provider call or real row update occurs. Always roll back.
BEGIN;
SET LOCAL statement_timeout = '20s';
CREATE TEMP TABLE penetration_run_marker(id integer) ON COMMIT DROP;
CREATE FUNCTION pg_temp.expect_denied(statement text, states text[] DEFAULT ARRAY['42501'])
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE code text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
    IF code = ANY(states) THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Unexpectedly allowed: %', statement;
END;
$$;
DO $$ BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated, anon',
    (SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()));
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_denied(text,text[]) TO authenticated, anon;

DO $$
DECLARE
  ids uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  employees uuid[];
  periods uuid[];
  tickets uuid[];
  actor uuid;
  inviter uuid;
  owner_role name := current_user;
  table_name text;
  n integer;
  value jsonb;
  statement text;
BEGIN
  SELECT id INTO inviter FROM public.funcionarios WHERE role='admin' AND ativo=true LIMIT 1;
  IF inviter IS NULL THEN RAISE EXCEPTION 'An existing active administrator is required'; END IF;
  -- An attacker cannot self-register using metadata in the absence of an invite.
  BEGIN
    INSERT INTO auth.users(id,email,raw_user_meta_data)
    VALUES(gen_random_uuid(),gen_random_uuid()::text||'@example.invalid','{"role":"admin","suporte":true}');
    RAISE EXCEPTION 'Signup without invitation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH actor IN ARRAY ids LOOP
    INSERT INTO public.funcionario_convites(email,nome,cpf,cargo,tipo_contrato,convidado_por)
    VALUES(actor::text||'@example.invalid','Pentest temporary identity','pentest-'||actor::text,'Test','pj',inviter);
    INSERT INTO auth.users(id,email,raw_user_meta_data)
    VALUES(actor,actor::text||'@example.invalid','{"role":"admin","suporte":true,"ativo":true}');
    IF EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=actor AND (role<>'employee' OR suporte<>false)) THEN
      RAISE EXCEPTION 'User metadata escalated account privileges';
    END IF;
  END LOOP;
  SELECT array_agg(f.id ORDER BY array_position(ids,f.auth_id)) INTO employees
  FROM public.funcionarios f WHERE auth_id=ANY(ids);
  UPDATE public.funcionarios SET role='admin' WHERE id=employees[3];
  UPDATE public.funcionarios SET ativo=false WHERE id=employees[4];
  INSERT INTO public.registros_ponto(funcionario_id,data,entrada,saida,saida_data,entrada_localizacao)
  SELECT id,public.kairopont_today_sp(),'08:00','17:00',public.kairopont_today_sp(),
    '{"status":"captured","latitude":0,"longitude":0,"accuracy":5}'::jsonb
  FROM public.funcionarios WHERE id=ANY(employees);
  INSERT INTO public.periodos_aquisitivos_ferias(funcionario_id,periodo_inicio,periodo_fim,prazo_concessivo)
  SELECT id,current_date-180,current_date+185,current_date+550 FROM public.funcionarios WHERE id=ANY(employees[1:2]);
  SELECT array_agg(id ORDER BY array_position(employees,funcionario_id)) INTO periods
  FROM public.periodos_aquisitivos_ferias WHERE funcionario_id=ANY(employees[1:2]);
  -- Explicit protocols avoid advancing a nontransactional production sequence.
  INSERT INTO public.support_tickets(protocol,funcionario_id,request_id,category,subject,description)
  OVERRIDING SYSTEM VALUE
  VALUES(-1000000001,employees[1],gen_random_uuid(),'ponto','Pentest test ticket','Temporary security test description'),
        (-1000000002,employees[2],gen_random_uuid(),'ponto','Pentest other ticket','Temporary security test description');
  SELECT array_agg(id ORDER BY array_position(employees,funcionario_id)) INTO tickets
  FROM public.support_tickets WHERE funcionario_id=ANY(employees[1:2]);

  PERFORM set_config('request.jwt.claim.sub',ids[1]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ids[1],'role','authenticated','user_metadata',jsonb_build_object('role','admin','suporte',true))::text,true);
  SET LOCAL ROLE authenticated;
  IF public.is_admin() OR public.is_support() THEN RAISE EXCEPTION 'Spoofed JWT metadata granted access'; END IF;
  FOREACH table_name IN ARRAY ARRAY['registros_ponto','documentos','periodos_aquisitivos_ferias','solicitacoes_ferias','notificacoes','support_tickets'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE funcionario_id=%L',table_name,employees[2]) INTO n;
    IF n<>0 THEN RAISE EXCEPTION 'Cross-employee disclosure: %',table_name; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.auditoria;
  IF n<>0 THEN RAISE EXCEPTION 'Employee can read administrative audit'; END IF;
  PERFORM pg_temp.expect_denied(format('UPDATE public.funcionarios SET role=''admin'', suporte=true WHERE id=%L',employees[1]));
  PERFORM pg_temp.expect_denied(format('UPDATE public.registros_ponto SET entrada_localizacao=''{}'' WHERE funcionario_id=%L',employees[1]));
  PERFORM pg_temp.expect_denied(format('DELETE FROM public.registros_ponto WHERE funcionario_id=%L',employees[1]));
  PERFORM pg_temp.expect_denied(format('SELECT public.registrar_ponto(%L,''entrada'',''{"status":"denied"}'')',employees[2]));
  PERFORM pg_temp.expect_denied(format('SELECT public.admin_update_employee(%L,true,''admin'')',employees[1]));
  PERFORM pg_temp.expect_denied(format('SELECT public.admin_update_employee_details(%L,''Attacker'',''Test'',null,null,''pj'',true)',employees[1]));
  PERFORM pg_temp.expect_denied(format('SELECT public.support_update_ticket_status(%L,''respondido'')',tickets[2]));
  PERFORM pg_temp.expect_denied('SELECT public.list_support_tickets(''todos'',0)');
  PERFORM pg_temp.expect_denied(format('SELECT public.claim_support_email(%L)',tickets[1]));
  PERFORM pg_temp.expect_denied('SELECT * FROM private.edge_rate_limits');
  PERFORM pg_temp.expect_denied('SELECT * FROM private.support_email_delivery');
  UPDATE public.feriados SET nome='Forged holiday';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Employee can alter holidays'; END IF;
  PERFORM pg_temp.expect_denied(format('SELECT public.registrar_ponto(%L,%L,''{}'')',employees[1], 'entrada''; DROP TABLE public.registros_ponto; --'),ARRAY['P0001']);
  PERFORM pg_temp.expect_denied(format('SELECT public.registrar_ponto(%L,''entrada'',%L::jsonb)',employees[1], '{"status":"captured","latitude":"0); DROP TABLE funcionarios; --","longitude":0,"accuracy":1}'),ARRAY['22023']);

  -- Inactive sessions must lose operational access even if their token is valid.
  PERFORM set_config('request.jwt.claim.sub',ids[4]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ids[4],'role','authenticated')::text,true);
  SELECT count(*) INTO n FROM public.registros_ponto;
  IF n<>0 THEN RAISE EXCEPTION 'Inactive employee can read punch coordinates'; END IF;
  PERFORM pg_temp.expect_denied(format('SELECT public.registrar_ponto(%L,''saida'',''{"status":"denied"}'')',employees[4]));

  -- An administrator without support access cannot use the ticket queue.
  PERFORM set_config('request.jwt.claim.sub',ids[3]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ids[3],'role','authenticated')::text,true);
  PERFORM pg_temp.expect_denied('SELECT public.list_support_tickets(''todos'',0)');
  PERFORM pg_temp.expect_denied(format('SELECT public.admin_update_employee(%L,true,NULL)',employees[3]),ARRAY['22023']);
  PERFORM pg_temp.expect_denied(format('SELECT public.admin_update_employee(%L,NULL,''employee'')',employees[1]),ARRAY['22023']);
  PERFORM pg_temp.expect_denied(format('SELECT public.admin_update_employee(%L,true,''employee'')',employees[3]),ARRAY['P0001']);
  PERFORM pg_temp.expect_denied(format('SELECT public.admin_update_employee_employment(%L,NULL,NULL,NULL)',employees[1]),ARRAY['P0001']);
  SELECT count(*) INTO n FROM public.registros_ponto WHERE funcionario_id=ANY(employees);
  IF n<>4 THEN RAISE EXCEPTION 'Legitimate admin access stopped working'; END IF;

  EXECUTE format('SET LOCAL ROLE %I',owner_role);
  UPDATE public.funcionarios SET suporte=true WHERE id=employees[1];
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',ids[1]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ids[1],'role','authenticated')::text,true);
  IF public.is_admin() OR NOT public.is_support() THEN RAISE EXCEPTION 'Support role separation failed'; END IF;
  SELECT count(*) INTO n FROM public.funcionarios WHERE id=employees[2];
  IF n<>0 THEN RAISE EXCEPTION 'Support grant disclosed colleague profile'; END IF;
  SELECT ticket INTO value FROM public.list_support_tickets('todos',0) ticket WHERE ticket->>'id'=tickets[2]::text;
  IF value IS NULL OR value->'employee' ? 'cpf' OR value ? 'response' OR value->'employee' ? 'escala_trabalho' THEN
    RAISE EXCEPTION 'Support contact projection disclosed unnecessary employee data';
  END IF;
  PERFORM pg_temp.expect_denied(format('SELECT public.admin_update_employee(%L,true,''admin'')',employees[1]));
  PERFORM pg_temp.expect_denied('SELECT public.list_support_tickets(''todos'',-1)',ARRAY['22023']);
  PERFORM pg_temp.expect_denied(format('SELECT public.support_update_ticket_status(%L,''invalid'')',tickets[2]),ARRAY['22023']);
  EXECUTE format('SET LOCAL ROLE %I',owner_role);
END;
$$;
ROLLBACK;
SELECT 'Extended penetration assertions passed; temporary identities, tickets and records rolled back.' AS result;
