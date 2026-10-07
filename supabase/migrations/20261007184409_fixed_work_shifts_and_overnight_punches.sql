ALTER TABLE public.registros_ponto
  ADD COLUMN IF NOT EXISTS turno_trabalhado text,
  ADD COLUMN IF NOT EXISTS saida_data date;

UPDATE public.registros_ponto
SET saida_data = data
WHERE saida IS NOT NULL AND saida_data IS NULL;

CREATE OR REPLACE FUNCTION public.kairopont_infer_shift(p_entry time)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_minute integer := extract(hour FROM p_entry)::integer * 60 + extract(minute FROM p_entry)::integer;
  v_shift text := 'turno1';
  v_distance integer := LEAST(ABS(v_minute - 480), 1440 - ABS(v_minute - 480));
  v_next integer;
BEGIN
  v_next := LEAST(ABS(v_minute - 840), 1440 - ABS(v_minute - 840));
  IF v_next < v_distance THEN v_shift := 'turno2'; v_distance := v_next; END IF;
  v_next := LEAST(ABS(v_minute - 1365), 1440 - ABS(v_minute - 1365));
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
  IF p_shift IS NULL OR p_shift NOT IN ('turno1', 'turno2', 'turno3') THEN RAISE EXCEPTION 'Turno inválido.'; END IF;
  v_entry := CASE p_shift WHEN 'turno1' THEN '08:00' WHEN 'turno2' THEN '14:00' ELSE '22:45' END;
  v_exit := CASE p_shift WHEN 'turno1' THEN '17:00' WHEN 'turno2' THEN '22:45' ELSE '06:15' END;
  v_lunch_out := CASE p_shift WHEN 'turno1' THEN '12:00' ELSE NULL END;
  v_lunch_return := CASE p_shift WHEN 'turno1' THEN '13:00' ELSE NULL END;
  FOR v_day IN 1..5 LOOP
    v_hours := v_hours || jsonb_build_object(v_day::text, jsonb_build_object(
      'entrada', v_entry, 'saida_almoco', v_lunch_out, 'retorno_almoco', v_lunch_return, 'saida', v_exit));
  END LOOP;
  v_hours := v_hours || jsonb_build_object('6', jsonb_build_object(
    'entrada', '08:00', 'saida_almoco', NULL, 'retorno_almoco', NULL, 'saida', '12:00'));
  RETURN jsonb_build_object('tipo', p_shift, 'turno_id', p_shift, 'dias_semana', '[1,2,3,4,5,6]'::jsonb, 'horarios_por_dia', v_hours);
END;
$$;
REVOKE ALL ON FUNCTION public.kairopont_infer_shift(time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kairopont_schedule_for_shift(text) FROM PUBLIC, anon, authenticated;

UPDATE public.registros_ponto
SET turno_trabalhado = public.kairopont_infer_shift(entrada)
WHERE entrada IS NOT NULL AND turno_trabalhado IS NULL;

UPDATE public.funcionarios
SET escala_trabalho = public.kairopont_schedule_for_shift(public.kairopont_infer_shift(
  COALESCE((escala_trabalho->'horarios_por_dia'->'1'->>'entrada')::time, (escala_trabalho->>'entrada')::time, '08:00'::time)))
WHERE escala_trabalho IS NOT NULL;

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
DECLARE
  v_shift text := p_escala_trabalho->>'turno_id';
  v_schedule jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_data_admissao IS NULL OR p_data_admissao > current_date OR v_shift IS NULL OR v_shift NOT IN ('turno1', 'turno2', 'turno3') THEN
    RAISE EXCEPTION 'Data de admissão ou turno inválido.';
  END IF;

  v_schedule := public.kairopont_schedule_for_shift(v_shift);

  UPDATE public.funcionarios
  SET data_admissao = p_data_admissao, escala_trabalho = v_schedule
  WHERE id = p_funcionario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;
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
  v_data date := (timezone('America/Sao_Paulo', now()))::date;
  v_hora time := (timezone('America/Sao_Paulo', now()))::time;
  v_record public.registros_ponto%ROWTYPE;
  v_shift text;
  v_shift_distance integer;
  v_entry_minute integer := extract(hour FROM (timezone('America/Sao_Paulo', now())))::integer * 60
    + extract(minute FROM (timezone('America/Sao_Paulo', now())))::integer;
  v_minute integer;
  v_tem_intervalo boolean;
BEGIN
  IF p_tipo NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida') THEN
    RAISE EXCEPTION 'Tipo de registro inválido.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.funcionarios WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true) THEN
    RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501';
  END IF;

  IF p_tipo = 'entrada' THEN
    IF EXISTS (SELECT 1 FROM public.registros_ponto WHERE funcionario_id = p_funcionario_id AND data = v_data AND entrada IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.registros_ponto WHERE funcionario_id = p_funcionario_id AND data = v_data - 1 AND turno_trabalhado = 'turno3' AND saida IS NULL) THEN
      RAISE EXCEPTION 'Já existe uma jornada em andamento ou uma entrada registrada.';
    END IF;

    v_shift_distance := LEAST(ABS(v_entry_minute - 480), 1440 - ABS(v_entry_minute - 480));
    v_shift := 'turno1';
    v_minute := LEAST(ABS(v_entry_minute - 840), 1440 - ABS(v_entry_minute - 840));
    IF v_minute < v_shift_distance THEN v_shift := 'turno2'; v_shift_distance := v_minute; END IF;
    v_minute := LEAST(ABS(v_entry_minute - 1365), 1440 - ABS(v_entry_minute - 1365));
    IF v_minute < v_shift_distance THEN v_shift := 'turno3'; END IF;

    INSERT INTO public.registros_ponto (funcionario_id, data, entrada, turno_trabalhado)
    VALUES (p_funcionario_id, v_data, v_hora, v_shift);
    RETURN;
  END IF;

  SELECT * INTO v_record FROM public.registros_ponto
  WHERE funcionario_id = p_funcionario_id AND data = v_data AND entrada IS NOT NULL AND saida IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_record FROM public.registros_ponto
    WHERE funcionario_id = p_funcionario_id AND data = v_data - 1 AND turno_trabalhado = 'turno3' AND entrada IS NOT NULL AND saida IS NULL
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há jornada aberta para registrar este ponto.'; END IF;

  v_tem_intervalo := coalesce(v_record.turno_trabalhado = 'turno1' AND extract(isodow FROM v_record.data) BETWEEN 1 AND 5, false);
  CASE p_tipo
    WHEN 'saida_almoco' THEN
      IF NOT v_tem_intervalo THEN RAISE EXCEPTION 'Esta jornada não possui intervalo de almoço configurado.'; END IF;
      IF v_record.saida_almoco IS NOT NULL THEN RAISE EXCEPTION 'Saída para almoço já registrada.'; END IF;
      UPDATE public.registros_ponto SET saida_almoco = v_hora WHERE id = v_record.id;
    WHEN 'retorno_almoco' THEN
      IF NOT v_tem_intervalo OR v_record.saida_almoco IS NULL OR v_record.retorno_almoco IS NOT NULL THEN RAISE EXCEPTION 'Sequência de ponto inválida.'; END IF;
      UPDATE public.registros_ponto SET retorno_almoco = v_hora WHERE id = v_record.id;
    WHEN 'saida' THEN
      IF v_tem_intervalo AND v_record.retorno_almoco IS NULL THEN RAISE EXCEPTION 'Registre o retorno do almoço primeiro.'; END IF;
      IF v_record.saida IS NOT NULL THEN RAISE EXCEPTION 'Saída já registrada.'; END IF;
      UPDATE public.registros_ponto SET saida = v_hora, saida_data = v_data WHERE id = v_record.id;
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text) TO authenticated;
