-- Run as the database owner after migrations. All fixtures and quota changes
-- are rolled back. This creates no login sessions and sends no emails.
BEGIN;
DO $$
DECLARE
  v_actor uuid;
  v_employee uuid;
  v_other uuid;
  v_admin uuid;
  v_inactive uuid;
  v_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_owner name := current_user;
  v_inviter uuid;
  v_count integer;
  v_result jsonb;
  v_i integer;
  v_name text;
BEGIN
  SELECT id INTO v_inviter FROM public.funcionarios WHERE role = 'admin' AND ativo = true LIMIT 1;
  IF v_inviter IS NULL THEN RAISE EXCEPTION 'An active admin is required to prepare test invitations.'; END IF;

  FOREACH v_actor IN ARRAY v_ids LOOP
    INSERT INTO public.funcionario_convites (email, nome, cpf, cargo, tipo_contrato, convidado_por)
    VALUES (v_actor::text || '@example.invalid', 'Security test', 'test-' || v_actor::text, 'Test', 'pj', v_inviter);
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_actor, v_actor::text || '@example.invalid', '{"role":"admin","ativo":true}'::jsonb);
    IF (SELECT role FROM public.funcionarios WHERE auth_id = v_actor) <> 'employee' THEN
      RAISE EXCEPTION 'User-controlled metadata escalated a new account.';
    END IF;
  END LOOP;
  SELECT id INTO v_employee FROM public.funcionarios WHERE auth_id = v_ids[1];
  SELECT id INTO v_other FROM public.funcionarios WHERE auth_id = v_ids[2];
  SELECT id INTO v_admin FROM public.funcionarios WHERE auth_id = v_ids[3];
  SELECT id INTO v_inactive FROM public.funcionarios WHERE auth_id = v_ids[4];
  UPDATE public.funcionarios SET tipo_contrato = 'clt' WHERE id = v_employee;
  UPDATE public.funcionarios SET role = 'admin' WHERE id = v_admin;
  UPDATE public.funcionarios SET ativo = false WHERE id = v_inactive;

  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('documentos', v_employee::text || '/test.pdf'), ('documentos', v_other::text || '/test.pdf');
  INSERT INTO public.documentos (funcionario_id, tipo, nome_arquivo, caminho_storage) VALUES
    (v_other, 'atestado', 'test.pdf', v_other::text || '/test.pdf');
  INSERT INTO public.notificacoes (funcionario_id, tipo, titulo, mensagem, referencia) VALUES
    (v_employee, 'test', 'Test', 'Original', v_ids[1]::text),
    (v_other, 'test', 'Test', 'Original', v_ids[2]::text);

  PERFORM set_config('request.jwt.claim.sub', v_ids[1]::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ids[1], 'role', 'authenticated', 'user_metadata', jsonb_build_object('role','admin'))::text, true);
  SET LOCAL ROLE authenticated;
  IF public.is_admin() THEN RAISE EXCEPTION 'Spoofed metadata granted administrator access.'; END IF;
  SELECT count(*) INTO v_count FROM public.funcionarios;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Employee can read other profiles.'; END IF;
  SELECT count(*) INTO v_count FROM public.documentos WHERE funcionario_id = v_other;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Employee can read another employee documents.'; END IF;
  SELECT count(*) INTO v_count FROM storage.objects WHERE bucket_id = 'documentos' AND name = v_other::text || '/test.pdf';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Employee can read another employee private files.'; END IF;

  UPDATE public.funcionarios SET nome = 'Updated' WHERE id = v_employee;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Own profile update stopped working.'; END IF;
  UPDATE public.funcionarios SET nome = 'Attacker' WHERE id = v_other;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Employee can change another profile.'; END IF;
  BEGIN
    UPDATE public.funcionarios SET role = 'admin' WHERE id = v_employee;
    RAISE EXCEPTION 'Employee can assign role.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.funcionarios SET ativo = true, auth_id = v_ids[2] WHERE id = v_employee;
    RAISE EXCEPTION 'Employee can assign status or identity.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.admin_update_employee(v_employee, true, 'admin');
    RAISE EXCEPTION 'Employee can call administrative RPC.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.consume_edge_rate_limit('invite-employee', v_ids[3]);
    RAISE EXCEPTION 'Employee can consume or reset server quotas.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.funcionario_convites;
    RAISE EXCEPTION 'Employee can read pending invitations.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  UPDATE public.notificacoes SET lida_em = now() WHERE funcionario_id = v_employee;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Marking a notification read stopped working.'; END IF;
  BEGIN
    UPDATE public.notificacoes SET mensagem = 'Forged', funcionario_id = v_other WHERE funcionario_id = v_employee;
    RAISE EXCEPTION 'Notification mass assignment is possible.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  INSERT INTO public.documentos (funcionario_id, tipo, nome_arquivo, caminho_storage)
  VALUES (v_employee, 'atestado', 'test.pdf', v_employee::text || '/test.pdf');
  BEGIN
    INSERT INTO public.documentos (funcionario_id, tipo, nome_arquivo, caminho_storage)
    VALUES (v_employee, 'atestado', 'test.pdf', v_other::text || '/test.pdf');
    RAISE EXCEPTION 'Document can reference another employee file.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.documentos (funcionario_id, tipo, nome_arquivo, caminho_storage)
    VALUES (v_employee, 'atestado', 'fake.pdf', v_employee::text || '/nonexistent.pdf');
    RAISE EXCEPTION 'Document can reference a nonexistent file.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.documentos (funcionario_id, tipo, nome_arquivo, caminho_storage, created_at)
    VALUES (v_employee, 'atestado', 'test.pdf', v_employee::text || '/test.pdf', '2000-01-01');
    RAISE EXCEPTION 'Client can forge document timestamps.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', v_ids[4]::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_ids[4],'role','authenticated')::text, true);
  UPDATE public.funcionarios SET nome = 'Inactive update' WHERE id = v_inactive;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Inactive account can edit a profile.'; END IF;
  SELECT count(*) INTO v_count FROM public.documentos;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Inactive account can read documents.'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_ids[3]::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_ids[3],'role','authenticated')::text, true);
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access stopped working.'; END IF;
  SELECT count(*) INTO v_count FROM public.funcionarios WHERE id = ANY(ARRAY[v_employee,v_other,v_admin,v_inactive]);
  IF v_count <> 4 THEN RAISE EXCEPTION 'Admin cannot read managed profiles.'; END IF;
  SELECT count(*) INTO v_count FROM public.documentos WHERE funcionario_id IN (v_employee, v_other);
  IF v_count <> 2 THEN RAISE EXCEPTION 'Admin cannot read documents across contracts.'; END IF;
  SELECT count(*) INTO v_count FROM storage.objects
  WHERE bucket_id = 'documentos' AND name IN (v_employee::text || '/test.pdf', v_other::text || '/test.pdf');
  IF v_count <> 2 THEN RAISE EXCEPTION 'Admin cannot read the managed private objects.'; END IF;
  PERFORM public.admin_update_employee(v_other, false, 'employee');

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.funcionarios;
    RAISE EXCEPTION 'Anonymous client can access employee profiles.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.is_admin();
    RAISE EXCEPTION 'Anonymous client can execute authenticated RPC.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  EXECUTE format('SET LOCAL ROLE %I', v_owner);
  -- No production counters persist from this test; the whole transaction rolls back.
  DELETE FROM private.edge_rate_limits;
  SET LOCAL ROLE service_role;
  FOR v_i IN 1..5 LOOP
    v_result := public.consume_edge_rate_limit('invite-employee', v_ids[3]);
    IF NOT (v_result->>'allowed')::boolean THEN RAISE EXCEPTION 'Quota blocked before its limit.'; END IF;
  END LOOP;
  v_result := public.consume_edge_rate_limit('invite-employee', v_ids[3]);
  IF (v_result->>'allowed')::boolean OR (v_result->>'retry_after')::integer NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Per-minute quota did not block the sixth invitation.';
  END IF;
  BEGIN
    PERFORM public.consume_edge_rate_limit('invite-employee', v_ids[1]);
    RAISE EXCEPTION 'Server quota accepted a non-admin actor.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.consume_edge_rate_limit('unknown-action', v_ids[3]);
    RAISE EXCEPTION 'Server quota accepted an arbitrary action.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  EXECUTE format('SET LOCAL ROLE %I', v_owner);
  UPDATE private.edge_rate_limits SET window_started_at = now() - interval '2 minutes'
    WHERE subject = v_ids[3]::text AND window_seconds = 60;
  SET LOCAL ROLE service_role;
  IF NOT (public.consume_edge_rate_limit('invite-employee',v_ids[3])->>'allowed')::boolean THEN
    RAISE EXCEPTION 'Expired quota did not reset.';
  END IF;
  EXECUTE format('SET LOCAL ROLE %I', v_owner);
  UPDATE private.edge_rate_limits SET requests = 30 WHERE subject = v_ids[3]::text AND window_seconds = 3600;
  SET LOCAL ROLE service_role;
  IF (public.consume_edge_rate_limit('invite-employee',v_ids[3])->>'allowed')::boolean THEN
    RAISE EXCEPTION 'Hourly quota failed.';
  END IF;
  EXECUTE format('SET LOCAL ROLE %I', v_owner);
  UPDATE private.edge_rate_limits SET requests = 1 WHERE subject = v_ids[3]::text;
  UPDATE private.edge_rate_limits SET requests = 200 WHERE subject = 'project' AND window_seconds = 86400;
  SET LOCAL ROLE service_role;
  IF (public.consume_edge_rate_limit('invite-employee',v_ids[3])->>'allowed')::boolean THEN
    RAISE EXCEPTION 'Global daily quota failed.';
  END IF;
  EXECUTE format('SET LOCAL ROLE %I', v_owner);

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'An exposed table has no RLS.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documentos' AND NOT public
    AND file_size_limit = 10485760 AND allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png','image/webp']) THEN
    RAISE EXCEPTION 'Document bucket limits are missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'fotos-funcionarios'
    AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']) THEN
    RAISE EXCEPTION 'Avatar bucket limits are missing.';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'Security regression checks passed; all fixtures rolled back.' AS result;
