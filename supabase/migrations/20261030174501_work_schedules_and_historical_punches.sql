-- Replace named shifts with three hour-based schedules while retaining legacy
-- ids in storage until every client has migrated.
CREATE OR REPLACE FUNCTION public.kairopont_infer_shift(p_entry time)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_minute integer := extract(hour FROM p_entry)::integer * 60 + extract(minute FROM p_entry)::integer;
  v_shift text := 'turno1';
  v_distance integer := LEAST(ABS(v_minute - 360), 1440 - ABS(v_minute - 360));
  v_next integer;
BEGIN
  v_next := LEAST(ABS(v_minute - 480), 1440 - ABS(v_minute - 480));
  IF v_next < v_distance THEN v_shift := 'turno2'; v_distance := v_next; END IF;
  v_next := LEAST(ABS(v_minute - 840), 1440 - ABS(v_minute - 840));
  IF v_next < v_distance THEN v_shift := 'turno3'; END IF;
  RETURN v_shift;
END;
$$;

CREATE OR REPLACE FUNCTION public.kairopont_schedule_for_shift(p_shift text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_entry text;
  v_exit text;
  v_lunch_out text;
  v_lunch_return text;
  v_hours jsonb := '{}'::jsonb;
  v_day integer;
BEGIN
  IF p_shift IS NULL OR p_shift NOT IN ('turno1', 'turno2', 'turno3') THEN
    RAISE EXCEPTION 'Horário inválido.';
  END IF;
  v_entry := CASE p_shift WHEN 'turno1' THEN '06:00' WHEN 'turno2' THEN '08:00' ELSE '14:00' END;
  v_exit := CASE p_shift WHEN 'turno1' THEN '15:00' WHEN 'turno2' THEN '17:00' ELSE '22:00' END;
  v_lunch_out := CASE p_shift WHEN 'turno3' THEN '18:00' ELSE '12:00' END;
  v_lunch_return := CASE p_shift WHEN 'turno3' THEN '19:00' ELSE '13:00' END;
  FOR v_day IN 1..5 LOOP
    v_hours := v_hours || jsonb_build_object(v_day::text, jsonb_build_object(
      'entrada', v_entry, 'saida_almoco', v_lunch_out, 'retorno_almoco', v_lunch_return, 'saida', v_exit));
  END LOOP;
  v_hours := v_hours || jsonb_build_object('6', jsonb_build_object(
    'entrada', v_entry, 'saida_almoco', NULL, 'retorno_almoco', NULL,
    'saida', (to_char((v_entry::time + interval '4 hours')::time, 'HH24:MI'))));
  RETURN jsonb_build_object('tipo', p_shift, 'turno_id', p_shift, 'dias_semana', '[1,2,3,4,5,6]'::jsonb, 'horarios_por_dia', v_hours);
END;
$$;
REVOKE ALL ON FUNCTION public.kairopont_infer_shift(time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kairopont_schedule_for_shift(text) FROM PUBLIC, anon, authenticated;

-- Round each expected start to the closest full hour and classify against the
-- hours actually registered for that employee. Fall back to the standard set.
CREATE OR REPLACE FUNCTION public.kairopont_infer_employee_schedule(p_schedule jsonb, p_entry time)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_expected record;
  v_actual integer := mod(((extract(hour FROM p_entry)::integer * 60 + extract(minute FROM p_entry)::integer + 30) / 60) * 60, 1440);
  v_expected_minute integer;
  v_best_shift text;
  v_best_distance integer := 1441;
  v_distance integer;
BEGIN
  IF p_entry IS NULL THEN RETURN NULL; END IF;
  FOR v_expected IN
    SELECT value->>'entrada' AS entry_time
    FROM jsonb_each(COALESCE(p_schedule->'horarios_por_dia', '{}'::jsonb))
    WHERE value->>'entrada' IS NOT NULL
  LOOP
    v_expected_minute := mod(((extract(hour FROM v_expected.entry_time::time)::integer * 60
      + extract(minute FROM v_expected.entry_time::time)::integer + 30) / 60) * 60, 1440);
    v_distance := LEAST(ABS(v_actual - v_expected_minute), 1440 - ABS(v_actual - v_expected_minute));
    IF v_distance < v_best_distance THEN
      v_best_distance := v_distance;
      v_best_shift := CASE v_expected_minute
        WHEN 360 THEN 'turno1' WHEN 480 THEN 'turno2' WHEN 840 THEN 'turno3'
        ELSE public.kairopont_infer_shift((v_expected_minute || ' minutes')::interval::time)
      END;
    END IF;
  END LOOP;
  RETURN COALESCE(v_best_shift, public.kairopont_infer_shift(p_entry));
END;
$$;
REVOKE ALL ON FUNCTION public.kairopont_infer_employee_schedule(jsonb, time) FROM PUBLIC, anon, authenticated;

-- Migrate existing presets while preserving the 08:00 schedule assigned to
-- employees who were on the old first shift.
UPDATE public.funcionarios
SET escala_trabalho = public.kairopont_schedule_for_shift(
  CASE
    WHEN escala_trabalho->'horarios_por_dia'->'1'->>'entrada' = '08:00' THEN 'turno2'
    WHEN escala_trabalho->'horarios_por_dia'->'1'->>'entrada' = '14:00' THEN 'turno3'
    ELSE 'turno1'
  END
)
WHERE escala_trabalho IS NOT NULL;

-- Respect a schedule submitted by the authenticated admin instead of silently
-- rebuilding it from a legacy shift id.
CREATE OR REPLACE FUNCTION public.admin_update_employee_employment(
  p_funcionario_id uuid,
  p_data_admissao date,
  p_escala_trabalho jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501'; END IF;
  IF p_data_admissao IS NULL OR p_data_admissao > public.kairopont_today_sp()
    OR p_escala_trabalho IS NULL OR jsonb_typeof(p_escala_trabalho->'horarios_por_dia') <> 'object'
    OR COALESCE(jsonb_typeof(p_escala_trabalho->'dias_semana'), '') <> 'array'
    OR COALESCE(p_escala_trabalho->>'turno_id', '') NOT IN ('turno1', 'turno2', 'turno3') THEN
    RAISE EXCEPTION 'Data de admissão ou horário inválido.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.funcionarios WHERE id = p_funcionario_id) THEN
    RAISE EXCEPTION 'Funcionário não encontrado.';
  END IF;
  UPDATE public.funcionarios
  SET data_admissao = p_data_admissao, escala_trabalho = p_escala_trabalho
  WHERE id = p_funcionario_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_ponto(p_funcionario_id uuid, p_tipo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp without time zone := timezone('America/Sao_Paulo', now());
  v_data date := (timezone('America/Sao_Paulo', now()))::date;
  v_hora time := (timezone('America/Sao_Paulo', now()))::time;
  v_record public.registros_ponto%ROWTYPE;
  v_tipo_contrato text;
  v_schedule jsonb;
  v_shift text;
  v_start timestamp without time zone;
  v_lunch_start timestamp without time zone;
  v_lunch_return timestamp without time zone;
  v_has_fixed_lunch boolean;
BEGIN
  SELECT tipo_contrato, escala_trabalho INTO v_tipo_contrato, v_schedule
  FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501'; END IF;
  IF p_tipo IS NULL OR (v_tipo_contrato = 'pj' AND p_tipo NOT IN ('entrada', 'saida'))
    OR (v_tipo_contrato = 'clt' AND p_tipo NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida')) THEN
    RAISE EXCEPTION 'Tipo de registro inválido para este vínculo.';
  END IF;

  IF p_tipo = 'entrada' THEN
    IF EXISTS (SELECT 1 FROM public.registros_ponto WHERE funcionario_id = p_funcionario_id
      AND entrada IS NOT NULL AND saida IS NULL AND data BETWEEN v_data - 1 AND v_data)
      OR EXISTS (SELECT 1 FROM public.registros_ponto WHERE funcionario_id = p_funcionario_id
      AND data = v_data AND entrada IS NOT NULL) THEN
      RAISE EXCEPTION 'Já existe uma jornada em andamento ou uma entrada registrada.';
    END IF;
    v_shift := public.kairopont_infer_employee_schedule(v_schedule, v_hora);
    INSERT INTO public.registros_ponto (funcionario_id, data, entrada, turno_trabalhado)
    VALUES (p_funcionario_id, v_data, v_hora, CASE WHEN v_tipo_contrato = 'pj' THEN NULL ELSE v_shift END);
    RETURN;
  END IF;

  SELECT * INTO v_record FROM public.registros_ponto
  WHERE funcionario_id = p_funcionario_id AND data = v_data AND entrada IS NOT NULL AND saida IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_record FROM public.registros_ponto
    WHERE funcionario_id = p_funcionario_id AND data = v_data - 1 AND entrada IS NOT NULL AND saida IS NULL
      AND (v_tipo_contrato = 'pj' OR turno_trabalhado = 'turno3') FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há jornada aberta para registrar este ponto.'; END IF;

  v_start := v_record.data + v_record.entrada;
  v_has_fixed_lunch := v_tipo_contrato = 'clt'
    AND extract(isodow FROM v_record.data) BETWEEN 1 AND 5
    AND v_record.turno_trabalhado IN ('turno1', 'turno2', 'turno3');
  CASE p_tipo
    WHEN 'saida_almoco' THEN
      IF v_tipo_contrato <> 'clt' OR v_has_fixed_lunch THEN RAISE EXCEPTION 'Esta jornada usa o almoço fixo.'; END IF;
      IF v_record.saida_almoco IS NOT NULL OR v_record.retorno_almoco IS NOT NULL THEN RAISE EXCEPTION 'A pausa já foi registrada.'; END IF;
      IF v_now <= v_start THEN RAISE EXCEPTION 'A saída para almoço precisa ocorrer depois da entrada.'; END IF;
      UPDATE public.registros_ponto SET saida_almoco = v_hora WHERE id = v_record.id;
    WHEN 'retorno_almoco' THEN
      IF v_tipo_contrato <> 'clt' OR v_has_fixed_lunch OR v_record.saida_almoco IS NULL OR v_record.retorno_almoco IS NOT NULL THEN
        RAISE EXCEPTION 'Sequência de ponto inválida para o retorno do almoço.';
      END IF;
      v_lunch_start := v_record.data + v_record.saida_almoco;
      IF v_lunch_start < v_start THEN v_lunch_start := v_lunch_start + interval '1 day'; END IF;
      IF v_now < v_lunch_start + interval '1 hour' THEN RAISE EXCEPTION 'A pausa de almoço deve durar pelo menos 1 hora.'; END IF;
      UPDATE public.registros_ponto SET retorno_almoco = v_hora WHERE id = v_record.id;
    WHEN 'saida' THEN
      IF v_tipo_contrato = 'clt' AND NOT v_has_fixed_lunch THEN
        IF v_record.saida_almoco IS NULL AND v_record.retorno_almoco IS NOT NULL THEN RAISE EXCEPTION 'O retorno do almoço não pode existir sem a saída correspondente.'; END IF;
        IF v_record.saida_almoco IS NOT NULL AND v_record.retorno_almoco IS NULL THEN RAISE EXCEPTION 'Registre o retorno do almoço após completar 1 hora de pausa.'; END IF;
        IF v_record.saida_almoco IS NOT NULL THEN
          v_lunch_start := v_record.data + v_record.saida_almoco;
          IF v_lunch_start < v_start THEN v_lunch_start := v_lunch_start + interval '1 day'; END IF;
          v_lunch_return := v_record.data + v_record.retorno_almoco;
          IF v_lunch_return < v_lunch_start THEN v_lunch_return := v_lunch_return + interval '1 day'; END IF;
          IF v_lunch_return < v_lunch_start + interval '1 hour' THEN RAISE EXCEPTION 'A pausa de almoço deve durar pelo menos 1 hora.'; END IF;
        ELSIF v_now > v_start + interval '6 hours' THEN RAISE EXCEPTION 'Jornadas acima de 6 horas exigem uma pausa de almoço de 1 hora.';
        END IF;
      END IF;
      IF v_record.saida IS NOT NULL THEN RAISE EXCEPTION 'Saída já registrada.'; END IF;
      UPDATE public.registros_ponto SET saida = v_hora, saida_data = v_data WHERE id = v_record.id;
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text) TO authenticated;

-- A required reason and administrator identity are recorded for corrections
-- outside the ordinary 96-hour edit window, including historical inserts.
CREATE OR REPLACE FUNCTION public.prevent_late_punch_record_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR NEW.funcionario_id IS DISTINCT FROM OLD.funcionario_id
    OR NEW.data IS DISTINCT FROM OLD.data OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'A identificação e a data-base do registro não podem ser alteradas.' USING ERRCODE = '42501';
  END IF;
  IF current_setting('kairopont.allow_historical_punch_edit', true) IS DISTINCT FROM 'on'
    AND (OLD.created_at IS NULL OR pg_catalog.clock_timestamp() >= OLD.created_at + interval '4 days') THEN
    RAISE EXCEPTION 'Prazo expirado. Este registro está bloqueado para alterações.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_late_punch_record_changes() FROM PUBLIC, anon, authenticated;

SELECT pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'on', true);
UPDATE public.registros_ponto r
SET turno_trabalhado = public.kairopont_infer_employee_schedule(f.escala_trabalho, r.entrada)
FROM public.funcionarios f
WHERE f.id = r.funcionario_id AND r.entrada IS NOT NULL;
SELECT pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'off', true);

CREATE OR REPLACE FUNCTION public.admin_apply_historical_punch(
  p_record_id uuid,
  p_funcionario_id uuid,
  p_data date,
  p_entrada time,
  p_saida_almoco time,
  p_retorno_almoco time,
  p_saida time,
  p_saida_data date,
  p_motivo text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_record public.registros_ponto%ROWTYPE;
  v_schedule jsonb;
  v_shift text;
  v_result_id uuid;
  v_lunch_start timestamp without time zone;
  v_lunch_return timestamp without time zone;
  v_work_start timestamp without time zone;
  v_work_end timestamp without time zone;
  v_action text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Administrador ativo não encontrado.' USING ERRCODE = '42501'; END IF;
  IF p_funcionario_id IS NULL OR p_data IS NULL OR p_entrada IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Informe funcionário, data, entrada e um motivo com pelo menos 10 caracteres.';
  END IF;
  SELECT escala_trabalho INTO v_schedule FROM public.funcionarios WHERE id = p_funcionario_id AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário ativo não encontrado.'; END IF;
  v_shift := public.kairopont_infer_employee_schedule(v_schedule, p_entrada);
  IF (p_saida_almoco IS NULL) <> (p_retorno_almoco IS NULL) THEN RAISE EXCEPTION 'Preencha os dois horários de almoço ou deixe ambos vazios.'; END IF;
  v_work_start := p_data + p_entrada;
  IF p_saida_almoco IS NOT NULL THEN
    v_lunch_start := p_data + p_saida_almoco;
    IF v_lunch_start <= v_work_start THEN v_lunch_start := v_lunch_start + interval '1 day'; END IF;
    v_lunch_return := p_data + p_retorno_almoco;
    IF v_lunch_return <= v_lunch_start THEN v_lunch_return := v_lunch_return + interval '1 day'; END IF;
    IF v_lunch_start <= v_work_start OR v_lunch_return < v_lunch_start + interval '1 hour' THEN
      RAISE EXCEPTION 'Confira os horários e a duração mínima de uma hora do almoço.';
    END IF;
  END IF;
  IF p_saida IS NULL THEN
    IF p_saida_data IS NOT NULL THEN RAISE EXCEPTION 'Informe a data da saída somente quando houver horário de saída.'; END IF;
  ELSE
    IF p_saida_data IS NULL OR p_saida_data NOT BETWEEN p_data AND p_data + 1 THEN RAISE EXCEPTION 'Confira a data da saída.'; END IF;
    v_work_end := p_saida_data + p_saida;
    IF v_work_end <= v_work_start THEN RAISE EXCEPTION 'A saída deve ocorrer depois da entrada.'; END IF;
    IF p_saida_almoco IS NOT NULL AND v_lunch_return >= v_work_end THEN RAISE EXCEPTION 'O retorno do almoço precisa ocorrer antes da saída.'; END IF;
  END IF;

  PERFORM pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'on', true);
  IF p_record_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.registros_ponto WHERE funcionario_id = p_funcionario_id AND data = p_data) THEN
      RAISE EXCEPTION 'Já existe um registro para este funcionário e data.';
    END IF;
    INSERT INTO public.registros_ponto (funcionario_id, data, entrada, saida_almoco, retorno_almoco, saida, saida_data, turno_trabalhado)
    VALUES (p_funcionario_id, p_data, p_entrada, p_saida_almoco, p_retorno_almoco, p_saida, p_saida_data, v_shift)
    RETURNING id INTO v_result_id;
    v_action := 'criar_registro_historico';
    INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
    VALUES (v_admin_id, v_action, p_funcionario_id, jsonb_build_object(
      'registro_id', v_result_id, 'motivo', pg_catalog.btrim(p_motivo),
      'depois', jsonb_build_object('data', p_data, 'entrada', p_entrada, 'saida_almoco', p_saida_almoco,
        'retorno_almoco', p_retorno_almoco, 'saida', p_saida, 'saida_data', p_saida_data, 'horario', v_shift)));
  ELSE
    SELECT * INTO v_record FROM public.registros_ponto WHERE id = p_record_id AND funcionario_id = p_funcionario_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro de ponto não encontrado para este funcionário.'; END IF;
    IF v_record.data IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'A data do registro não pode ser alterada.'; END IF;
    UPDATE public.registros_ponto
    SET entrada = p_entrada, saida_almoco = p_saida_almoco, retorno_almoco = p_retorno_almoco,
      saida = p_saida, saida_data = p_saida_data, turno_trabalhado = v_shift
    WHERE id = p_record_id;
    v_result_id := p_record_id;
    v_action := 'editar_registro_historico';
    INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
    VALUES (v_admin_id, v_action, p_funcionario_id, jsonb_build_object(
      'registro_id', p_record_id, 'motivo', pg_catalog.btrim(p_motivo),
      'antes', jsonb_build_object('entrada', v_record.entrada, 'saida_almoco', v_record.saida_almoco,
        'retorno_almoco', v_record.retorno_almoco, 'saida', v_record.saida, 'saida_data', v_record.saida_data,
        'horario', v_record.turno_trabalhado),
      'depois', jsonb_build_object('entrada', p_entrada, 'saida_almoco', p_saida_almoco,
        'retorno_almoco', p_retorno_almoco, 'saida', p_saida, 'saida_data', p_saida_data, 'horario', v_shift)));
  END IF;
  RETURN v_result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_apply_historical_punch(uuid, uuid, date, time, time, time, time, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_historical_punch(uuid, uuid, date, time, time, time, time, date, text) TO authenticated;
