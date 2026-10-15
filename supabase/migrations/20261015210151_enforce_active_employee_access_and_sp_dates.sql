-- Align business-date rules to the same São Paulo calendar used by punch RPCs.
CREATE OR REPLACE FUNCTION public.kairopont_today_sp()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
$$;
REVOKE ALL ON FUNCTION public.kairopont_today_sp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kairopont_today_sp() TO authenticated;

-- Keep the profile row readable so the app can explain that an account is inactive,
-- while removing the inactive account's access to operational data and files.
DROP POLICY IF EXISTS "Funcionário atualiza somente o próprio perfil; admin atualiza perfis" ON public.funcionarios;
CREATE POLICY "Funcionário ativo atualiza o próprio perfil; admin atualiza perfis"
  ON public.funcionarios FOR UPDATE TO authenticated
  USING (
    (auth_id = (SELECT auth.uid()) AND ativo = true)
    OR (SELECT public.is_admin())
  )
  WITH CHECK (
    (auth_id = (SELECT auth.uid()) AND ativo = true)
    OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS "Funcionário lê os próprios registros; admin lê todos" ON public.registros_ponto;
CREATE POLICY "Funcionário ativo lê os próprios registros; admin lê todos"
  ON public.registros_ponto FOR SELECT TO authenticated
  USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    ) OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS "Funcionário lê os próprios documentos; admin lê todos" ON public.documentos;
CREATE POLICY "Funcionário ativo lê os próprios documentos; admin lê todos"
  ON public.documentos FOR SELECT TO authenticated
  USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    ) OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS "Funcionário envia somente os próprios documentos" ON public.documentos;
CREATE POLICY "Funcionário ativo envia somente os próprios documentos"
  ON public.documentos FOR INSERT TO authenticated
  WITH CHECK (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    )
  );

DROP POLICY IF EXISTS "Funcionário e admin consultam períodos de férias autorizados" ON public.periodos_aquisitivos_ferias;
CREATE POLICY "Funcionário ativo e admin consultam períodos de férias autorizados"
  ON public.periodos_aquisitivos_ferias FOR SELECT TO authenticated
  USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    ) OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS "Funcionário e admin consultam solicitações autorizadas" ON public.solicitacoes_ferias;
CREATE POLICY "Funcionário ativo e admin consultam solicitações autorizadas"
  ON public.solicitacoes_ferias FOR SELECT TO authenticated
  USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    ) OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS "Funcionário consulta e marca suas notificações" ON public.notificacoes;
CREATE POLICY "Funcionário ativo consulta suas notificações"
  ON public.notificacoes FOR SELECT TO authenticated
  USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    )
  );

DROP POLICY IF EXISTS "Funcionário atualiza leitura das próprias notificações" ON public.notificacoes;
CREATE POLICY "Funcionário ativo atualiza leitura das próprias notificações"
  ON public.notificacoes FOR UPDATE TO authenticated
  USING (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    )
  )
  WITH CHECK (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    )
  );

DROP POLICY IF EXISTS "Funcionário envia documento para a própria pasta" ON storage.objects;
CREATE POLICY "Funcionário ativo envia documento para a própria pasta"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND f.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Funcionário ativo remove somente documento órfão próprio"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND f.id::text = (storage.foldername(name))[1]
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.documentos d
      WHERE d.caminho_storage = storage.objects.name
    )
  );

DROP POLICY IF EXISTS "Funcionário ou admin lê documento autorizado" ON storage.objects;
CREATE POLICY "Funcionário ativo ou admin lê documento autorizado"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos' AND (
      EXISTS (
        SELECT 1 FROM public.funcionarios f
        WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
          AND f.id::text = (storage.foldername(name))[1]
      ) OR (SELECT public.is_admin())
    )
  );

DROP POLICY IF EXISTS "Funcionário envia foto para a própria pasta" ON storage.objects;
CREATE POLICY "Funcionário ativo envia foto para a própria pasta"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fotos-funcionarios' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND f.id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Funcionário atualiza foto na própria pasta" ON storage.objects;
CREATE POLICY "Funcionário ativo atualiza foto na própria pasta"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fotos-funcionarios' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND f.id::text = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'fotos-funcionarios' AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo = true
        AND f.id::text = (storage.foldername(name))[1]
    )
  );

-- Enforce the CLT/PJ contract on the server too. PJ profiles do not need a CLT shift.
ALTER TABLE public.funcionario_convites
  ALTER COLUMN data_admissao DROP NOT NULL,
  ALTER COLUMN escala_trabalho DROP NOT NULL;

-- The client-side schedule calculation credits 44 hours per week. The old SQL
-- schedule ended turno 3 Saturday at 00:32, which left the weekly total short.
UPDATE public.funcionarios
SET escala_trabalho = jsonb_set(
  escala_trabalho,
  '{horarios_por_dia,6}',
  '{"entrada":"22:45","saida_almoco":null,"retorno_almoco":null,"saida":"05:36"}'::jsonb,
  true
)
WHERE escala_trabalho->>'turno_id' = 'turno3'
  AND jsonb_typeof(escala_trabalho->'horarios_por_dia') = 'object'
  AND escala_trabalho->'horarios_por_dia'->'6' IS NOT NULL;

UPDATE public.funcionarios
SET escala_trabalho = jsonb_set(
  escala_trabalho,
  '{horarios_por_dia,6,saida}',
  '"18:33"'::jsonb,
  true
)
WHERE escala_trabalho->>'turno_id' = 'turno2'
  AND jsonb_typeof(escala_trabalho->'horarios_por_dia') = 'object'
  AND escala_trabalho->'horarios_por_dia'->'6' IS NOT NULL;

UPDATE public.funcionario_convites
SET escala_trabalho = jsonb_set(
  escala_trabalho,
  '{horarios_por_dia,6}',
  '{"entrada":"22:45","saida_almoco":null,"retorno_almoco":null,"saida":"05:36"}'::jsonb,
  true
)
WHERE tipo_contrato = 'clt'
  AND escala_trabalho->>'turno_id' = 'turno3'
  AND jsonb_typeof(escala_trabalho->'horarios_por_dia') = 'object'
  AND escala_trabalho->'horarios_por_dia'->'6' IS NOT NULL;

UPDATE public.funcionario_convites
SET escala_trabalho = jsonb_set(
  escala_trabalho,
  '{horarios_por_dia,6,saida}',
  '"18:33"'::jsonb,
  true
)
WHERE tipo_contrato = 'clt'
  AND escala_trabalho->>'turno_id' = 'turno2'
  AND jsonb_typeof(escala_trabalho->'horarios_por_dia') = 'object'
  AND escala_trabalho->'horarios_por_dia'->'6' IS NOT NULL;

-- Keep the canonical SQL schedule aligned with the client and invitation API.
CREATE OR REPLACE FUNCTION public.kairopont_schedule_for_shift(p_shift text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_entry text;
  v_exit text;
  v_saturday_entry text;
  v_saturday_exit text;
  v_lunch_out text;
  v_lunch_return text;
  v_hours jsonb := '{}'::jsonb;
  v_day integer;
BEGIN
  IF p_shift IS NULL OR p_shift NOT IN ('turno1', 'turno2', 'turno3') THEN
    RAISE EXCEPTION 'Turno inválido.';
  END IF;
  v_entry := CASE p_shift WHEN 'turno1' THEN '08:00' WHEN 'turno2' THEN '14:00' ELSE '22:45' END;
  v_exit := CASE p_shift WHEN 'turno1' THEN '17:00' WHEN 'turno2' THEN '22:52' ELSE '06:15' END;
  v_saturday_entry := CASE p_shift WHEN 'turno1' THEN '08:00' WHEN 'turno2' THEN '14:30' ELSE '22:45' END;
  v_saturday_exit := CASE p_shift WHEN 'turno1' THEN '12:00' WHEN 'turno2' THEN '18:33' ELSE '05:36' END;
  v_lunch_out := CASE p_shift WHEN 'turno1' THEN '12:00' WHEN 'turno2' THEN '19:00' ELSE '02:00' END;
  v_lunch_return := CASE p_shift WHEN 'turno1' THEN '13:00' WHEN 'turno2' THEN '20:00' ELSE '03:00' END;

  FOR v_day IN 1..5 LOOP
    v_hours := v_hours || jsonb_build_object(v_day::text, jsonb_build_object(
      'entrada', v_entry,
      'saida_almoco', v_lunch_out,
      'retorno_almoco', v_lunch_return,
      'saida', v_exit
    ));
  END LOOP;
  v_hours := v_hours || jsonb_build_object('6', jsonb_build_object(
    'entrada', v_saturday_entry,
    'saida_almoco', NULL,
    'retorno_almoco', NULL,
    'saida', v_saturday_exit
  ));
  RETURN jsonb_build_object(
    'tipo', p_shift,
    'turno_id', p_shift,
    'dias_semana', '[1,2,3,4,5,6]'::jsonb,
    'horarios_por_dia', v_hours
  );
END;
$$;
REVOKE ALL ON FUNCTION public.kairopont_schedule_for_shift(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_employee_employment(
  p_funcionario_id uuid,
  p_data_admissao date,
  p_escala_trabalho jsonb,
  p_tipo_contrato text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo_contrato NOT IN ('clt', 'pj') THEN
    RAISE EXCEPTION 'Tipo de vínculo inválido.';
  END IF;
  IF p_data_admissao IS NOT NULL AND p_data_admissao > public.kairopont_today_sp() THEN
    RAISE EXCEPTION 'Data de admissão inválida.';
  END IF;

  IF p_tipo_contrato = 'clt' THEN
    IF p_data_admissao IS NULL OR p_escala_trabalho IS NULL THEN
      RAISE EXCEPTION 'CLT precisa de data de admissão e escala de trabalho.';
    END IF;
    PERFORM public.admin_update_employee_employment(
      p_funcionario_id, p_data_admissao, p_escala_trabalho
    );
    UPDATE public.funcionarios SET tipo_contrato = 'clt' WHERE id = p_funcionario_id;
  ELSE
    UPDATE public.funcionarios
    SET data_admissao = p_data_admissao,
        escala_trabalho = NULL,
        tipo_contrato = 'pj'
    WHERE id = p_funcionario_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb, text) TO authenticated;
-- Force clients through the contract-aware function above.
REVOKE ALL ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_employee(
  p_funcionario_id uuid,
  p_ativo boolean,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_target public.funcionarios%ROWTYPE;
  v_remaining_admins integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('employee', 'admin') THEN RAISE EXCEPTION 'Perfil inválido.'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(190317, 240001);

  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  SELECT * INTO v_target FROM public.funcionarios WHERE id = p_funcionario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;

  IF v_target.id = v_admin_id AND (p_ativo IS DISTINCT FROM true OR p_role <> 'admin') THEN
    RAISE EXCEPTION 'Não é possível desativar ou rebaixar a própria conta administrativa.';
  END IF;
  IF v_target.role = 'admin' AND v_target.ativo = true
    AND (p_ativo IS DISTINCT FROM true OR p_role <> 'admin') THEN
    SELECT count(*) INTO v_remaining_admins FROM public.funcionarios
    WHERE role = 'admin' AND ativo = true AND id <> v_target.id;
    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'O sistema precisa manter pelo menos um administrador ativo.';
    END IF;
  END IF;

  UPDATE public.funcionarios SET ativo = p_ativo, role = p_role WHERE id = p_funcionario_id;
  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (v_admin_id, 'atualizar_funcionario', p_funcionario_id,
    jsonb_build_object('ativo', p_ativo, 'role', p_role));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_employee(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_employee(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_current_vacation_periods()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee record;
  v_years integer;
  v_cycle integer;
  v_period_start date;
  v_period_end date;
  v_due date;
  v_employee_id uuid;
  v_today date := public.kairopont_today_sp();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501';
  END IF;

  IF public.is_admin() THEN
    FOR v_employee IN
      SELECT id, data_admissao FROM public.funcionarios
      WHERE ativo = true AND tipo_contrato = 'clt' AND data_admissao IS NOT NULL
    LOOP
      v_employee_id := v_employee.id;
      v_years := extract(year FROM age(v_today, v_employee.data_admissao))::integer;
      FOR v_cycle IN 0..greatest(v_years, 0) LOOP
        v_period_start := (v_employee.data_admissao + make_interval(years => v_cycle))::date;
        v_period_end := (v_period_start + interval '1 year' - interval '1 day')::date;
        v_due := (v_period_start + interval '2 years' - interval '1 day')::date;
        INSERT INTO public.periodos_aquisitivos_ferias (funcionario_id, periodo_inicio, periodo_fim, prazo_concessivo)
        VALUES (v_employee_id, v_period_start, v_period_end, v_due)
        ON CONFLICT (funcionario_id, periodo_inicio) DO NOTHING;
      END LOOP;
    END LOOP;
  ELSE
    SELECT id, data_admissao INTO v_employee
    FROM public.funcionarios
    WHERE auth_id = auth.uid() AND ativo = true AND tipo_contrato = 'clt';
    IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário CLT ativo não encontrado.' USING ERRCODE = '42501'; END IF;
    IF v_employee.data_admissao IS NULL THEN RETURN; END IF;

    v_employee_id := v_employee.id;
    v_years := extract(year FROM age(v_today, v_employee.data_admissao))::integer;
    FOR v_cycle IN 0..greatest(v_years, 0) LOOP
      v_period_start := (v_employee.data_admissao + make_interval(years => v_cycle))::date;
      v_period_end := (v_period_start + interval '1 year' - interval '1 day')::date;
      v_due := (v_period_start + interval '2 years' - interval '1 day')::date;
      INSERT INTO public.periodos_aquisitivos_ferias (funcionario_id, periodo_inicio, periodo_fim, prazo_concessivo)
      VALUES (v_employee_id, v_period_start, v_period_end, v_due)
      ON CONFLICT (funcionario_id, periodo_inicio) DO NOTHING;
    END LOOP;
  END IF;

  INSERT INTO public.notificacoes (funcionario_id, tipo, titulo, mensagem, referencia)
  SELECT p.funcionario_id,
    CASE WHEN p.prazo_concessivo < v_today THEN 'ferias_vencidas' ELSE 'ferias_vencimento_proximo' END,
    CASE WHEN p.prazo_concessivo < v_today THEN 'Prazo de férias vencido' ELSE 'Prazo de férias próximo' END,
    CASE WHEN p.prazo_concessivo < v_today
      THEN 'O prazo concessivo do período iniciado em ' || to_char(p.periodo_inicio, 'DD/MM/YYYY') || ' terminou em ' || to_char(p.prazo_concessivo, 'DD/MM/YYYY') || '. Procure o administrador.'
      ELSE 'O prazo concessivo do período iniciado em ' || to_char(p.periodo_inicio, 'DD/MM/YYYY') || ' termina em ' || to_char(p.prazo_concessivo, 'DD/MM/YYYY') || '.'
    END,
    CASE WHEN p.prazo_concessivo < v_today THEN 'ferias-vencidas:' ELSE 'ferias-prazo:' END || p.id::text
  FROM public.periodos_aquisitivos_ferias p
  WHERE ((public.is_admin()) OR p.funcionario_id = v_employee_id)
    AND p.prazo_concessivo <= v_today + 60
    AND NOT EXISTS (
      SELECT 1 FROM public.solicitacoes_ferias r
      WHERE r.periodo_id = p.id AND r.status = 'aprovada'
    )
  ON CONFLICT (referencia) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_current_vacation_periods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_current_vacation_periods() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_vacation_sale_intention(
  p_periodo_id uuid,
  p_dias_abono smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee public.funcionarios%ROWTYPE;
  v_period public.periodos_aquisitivos_ferias%ROWTYPE;
  v_today date := public.kairopont_today_sp();
BEGIN
  SELECT * INTO v_employee FROM public.funcionarios
  WHERE auth_id = auth.uid() AND ativo = true AND tipo_contrato = 'clt';
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário CLT ativo não encontrado.' USING ERRCODE = '42501'; END IF;
  IF p_dias_abono < 0 OR p_dias_abono > 10 THEN RAISE EXCEPTION 'O abono deve ser de 0 a 10 dias.'; END IF;

  SELECT * INTO v_period FROM public.periodos_aquisitivos_ferias
  WHERE id = p_periodo_id AND funcionario_id = v_employee.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período aquisitivo não encontrado.'; END IF;
  IF v_today > v_period.periodo_fim - 15 THEN
    RAISE EXCEPTION 'O prazo para registrar o abono deste período terminou.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'aprovada') THEN
    RAISE EXCEPTION 'Este período já possui férias aprovadas.';
  END IF;

  UPDATE public.periodos_aquisitivos_ferias
  SET dias_abono = p_dias_abono, abono_solicitado_em = now()
  WHERE id = v_period.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_vacation_sale_intention(uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vacation_sale_intention(uuid, smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_vacation_request_with_return(
  p_periodo_id uuid,
  p_data_saida date,
  p_data_retorno date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee public.funcionarios%ROWTYPE;
  v_period public.periodos_aquisitivos_ferias%ROWTYPE;
  v_request_id uuid;
  v_last_vacation_day date;
  v_days integer;
  v_today date := public.kairopont_today_sp();
BEGIN
  SELECT * INTO v_employee FROM public.funcionarios
  WHERE auth_id = auth.uid() AND ativo = true AND tipo_contrato = 'clt';
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário CLT ativo não encontrado.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_period FROM public.periodos_aquisitivos_ferias
  WHERE id = p_periodo_id AND funcionario_id = v_employee.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período aquisitivo não encontrado.'; END IF;
  IF v_today <= v_period.periodo_fim THEN RAISE EXCEPTION 'As datas de gozo só podem ser solicitadas após completar um ano.'; END IF;
  IF p_data_saida IS NULL OR p_data_retorno IS NULL OR p_data_retorno <= p_data_saida THEN
    RAISE EXCEPTION 'A data de retorno precisa ser posterior à data de saída.';
  END IF;
  v_last_vacation_day := p_data_retorno - 1;
  IF v_today > v_period.prazo_concessivo OR v_last_vacation_day > v_period.prazo_concessivo THEN
    RAISE EXCEPTION 'As férias precisam ocorrer dentro do prazo concessivo.';
  END IF;
  IF p_data_saida < v_today + 30 THEN RAISE EXCEPTION 'Escolha uma data de saída com pelo menos 30 dias de antecedência.'; END IF;
  v_days := p_data_retorno - p_data_saida;
  IF v_days + v_period.dias_abono <> v_period.dias_direito THEN
    RAISE EXCEPTION 'O período deve totalizar % dias, considerando o abono registrado.', v_period.dias_direito;
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'aprovada') THEN
    RAISE EXCEPTION 'Este período já foi aprovado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'pendente') THEN
    RAISE EXCEPTION 'Já existe uma solicitação pendente para este período.';
  END IF;

  INSERT INTO public.solicitacoes_ferias (periodo_id, funcionario_id, data_inicio, data_fim, data_retorno)
  VALUES (v_period.id, v_employee.id, p_data_saida, v_last_vacation_day, p_data_retorno)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_vacation_request_with_return(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_vacation_request_with_return(uuid, date, date) TO authenticated;

-- Preserve the older endpoint's "last vacation day" contract without its UTC date rules.
CREATE OR REPLACE FUNCTION public.submit_vacation_request(
  p_periodo_id uuid,
  p_data_inicio date,
  p_data_fim date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_data_fim IS NULL THEN RAISE EXCEPTION 'Informe o último dia das férias.'; END IF;
  RETURN public.submit_vacation_request_with_return(p_periodo_id, p_data_inicio, p_data_fim + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_vacation_request(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_vacation_request(uuid, date, date) TO authenticated;
