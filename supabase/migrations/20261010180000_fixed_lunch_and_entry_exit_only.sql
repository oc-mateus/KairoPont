-- Define horários fixos de almoço para CLT e simplifica o registro a entrada/saída.
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
  v_saturday_exit := CASE p_shift WHEN 'turno1' THEN '12:00' WHEN 'turno2' THEN '18:30' ELSE '00:32' END;
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

-- Normaliza as escalas CLT ativas e convites pendentes para os novos horários fixos.
UPDATE public.funcionarios
SET escala_trabalho = public.kairopont_schedule_for_shift(escala_trabalho->>'turno_id')
WHERE tipo_contrato = 'clt'
  AND escala_trabalho->>'turno_id' IN ('turno1', 'turno2', 'turno3');

UPDATE public.funcionario_convites
SET escala_trabalho = public.kairopont_schedule_for_shift(escala_trabalho->>'turno_id')
WHERE tipo_contrato = 'clt'
  AND escala_trabalho->>'turno_id' IN ('turno1', 'turno2', 'turno3');

-- Desde esta versão, CLT e PJ registram somente a entrada e a saída.
-- A pausa CLT é calculada a partir do intervalo fixo do turno no relatório.
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
  v_tipo_contrato text;
  v_shift text;
  v_shift_distance integer;
  v_entry_minute integer := extract(hour FROM (timezone('America/Sao_Paulo', now())))::integer * 60
    + extract(minute FROM (timezone('America/Sao_Paulo', now())))::integer;
  v_minute integer;
BEGIN
  SELECT tipo_contrato INTO v_tipo_contrato
  FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN ('entrada', 'saida') THEN
    RAISE EXCEPTION 'Registre somente entrada e saída.';
  END IF;

  IF p_tipo = 'entrada' THEN
    IF EXISTS (
      SELECT 1 FROM public.registros_ponto
      WHERE funcionario_id = p_funcionario_id AND entrada IS NOT NULL AND saida IS NULL
        AND data >= v_data - 1 AND data <= v_data
    ) OR EXISTS (
      SELECT 1 FROM public.registros_ponto
      WHERE funcionario_id = p_funcionario_id AND data = v_data AND entrada IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Já existe uma jornada em andamento ou uma entrada registrada.';
    END IF;

    v_shift_distance := LEAST(ABS(v_entry_minute - 480), 1440 - ABS(v_entry_minute - 480));
    v_shift := 'turno1';
    v_minute := LEAST(ABS(v_entry_minute - 840), 1440 - ABS(v_entry_minute - 840));
    IF v_minute < v_shift_distance THEN
      v_shift := 'turno2';
      v_shift_distance := v_minute;
    END IF;
    v_minute := LEAST(ABS(v_entry_minute - 1365), 1440 - ABS(v_entry_minute - 1365));
    IF v_minute < v_shift_distance THEN v_shift := 'turno3'; END IF;

    INSERT INTO public.registros_ponto (funcionario_id, data, entrada, turno_trabalhado)
    VALUES (p_funcionario_id, v_data, v_hora, CASE WHEN v_tipo_contrato = 'pj' THEN NULL ELSE v_shift END);
    RETURN;
  END IF;

  SELECT * INTO v_record
  FROM public.registros_ponto
  WHERE funcionario_id = p_funcionario_id AND data = v_data
    AND entrada IS NOT NULL AND saida IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_record
    FROM public.registros_ponto
    WHERE funcionario_id = p_funcionario_id AND data = v_data - 1
      AND entrada IS NOT NULL AND saida IS NULL
      AND (v_tipo_contrato = 'pj' OR turno_trabalhado = 'turno3')
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há jornada aberta para registrar este ponto.';
  END IF;

  UPDATE public.registros_ponto
  SET saida = v_hora, saida_data = v_data
  WHERE id = v_record.id;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text) TO authenticated;
