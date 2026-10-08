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
  v_lunch_out := CASE p_shift WHEN 'turno1' THEN '12:00' WHEN 'turno2' THEN '19:30' ELSE NULL END;
  v_lunch_return := CASE p_shift WHEN 'turno1' THEN '13:00' WHEN 'turno2' THEN '20:30' ELSE NULL END;
  FOR v_day IN 1..5 LOOP
    v_hours := v_hours || jsonb_build_object(v_day::text, jsonb_build_object(
      'entrada', v_entry, 'saida_almoco', v_lunch_out, 'retorno_almoco', v_lunch_return, 'saida', v_exit));
  END LOOP;
  v_hours := v_hours || jsonb_build_object('6', jsonb_build_object(
    'entrada', '08:00', 'saida_almoco', NULL, 'retorno_almoco', NULL, 'saida', '12:00'));
  RETURN jsonb_build_object('tipo', p_shift, 'turno_id', p_shift, 'dias_semana', '[1,2,3,4,5,6]'::jsonb, 'horarios_por_dia', v_hours);
END;
$$;
REVOKE ALL ON FUNCTION public.kairopont_schedule_for_shift(text) FROM PUBLIC, anon, authenticated;

UPDATE public.funcionarios
SET escala_trabalho = public.kairopont_schedule_for_shift('turno2')
WHERE escala_trabalho->>'turno_id' = 'turno2';

DO $$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.registrar_ponto(uuid, text)'::regprocedure)
  INTO v_definition;
  v_updated := replace(
    v_definition,
    'v_tem_intervalo := coalesce(v_record.turno_trabalhado = ''turno1'' AND extract(isodow FROM v_record.data) BETWEEN 1 AND 5, false);',
    'v_tem_intervalo := coalesce(v_record.turno_trabalhado IN (''turno1'', ''turno2'') AND extract(isodow FROM v_record.data) BETWEEN 1 AND 5, false);'
  );
  IF v_updated = v_definition THEN RAISE EXCEPTION 'Não foi possível atualizar a regra de intervalo do registro de ponto.'; END IF;
  EXECUTE v_updated;

  SELECT pg_catalog.pg_get_functiondef('public.admin_edit_punch_record(uuid, time, time, time, time, date)'::regprocedure)
  INTO v_definition;
  v_updated := replace(
    v_definition,
    'v_has_lunch := v_turno = ''turno1'' AND v_weekday BETWEEN 1 AND 5;',
    'v_has_lunch := v_turno IN (''turno1'', ''turno2'') AND v_weekday BETWEEN 1 AND 5;'
  );
  v_updated := replace(
    v_updated,
    $old$  IF (p_saida_almoco IS NULL) <> (p_retorno_almoco IS NULL) THEN
    RAISE EXCEPTION 'Preencha os dois horários de almoço ou deixe ambos vazios.';
  END IF;
  IF v_has_lunch AND p_saida_almoco IS NULL THEN
    RAISE EXCEPTION 'Para o 1º turno em dia útil, informe saída e retorno do almoço.';
  END IF;
  IF NOT v_has_lunch AND p_saida_almoco IS NOT NULL THEN
    RAISE EXCEPTION 'O turno classificado não prevê intervalo de almoço neste dia.';
  END IF;
  IF p_saida_almoco IS NOT NULL AND NOT (p_entrada < p_saida_almoco AND p_saida_almoco < p_retorno_almoco) THEN
    RAISE EXCEPTION 'Confira a ordem dos horários de entrada e almoço.';
  END IF;$old$,
    $new$  IF p_retorno_almoco IS NOT NULL AND p_saida_almoco IS NULL THEN
    RAISE EXCEPTION 'Informe a saída para almoço antes do retorno.';
  END IF;
  IF NOT v_has_lunch AND (p_saida_almoco IS NOT NULL OR p_retorno_almoco IS NOT NULL) THEN
    RAISE EXCEPTION 'O turno classificado não prevê intervalo de almoço neste dia.';
  END IF;
  IF p_saida_almoco IS NOT NULL AND p_entrada >= p_saida_almoco THEN
    RAISE EXCEPTION 'Confira a ordem dos horários de entrada e almoço.';
  END IF;
  IF p_retorno_almoco IS NOT NULL AND p_saida_almoco >= p_retorno_almoco THEN
    RAISE EXCEPTION 'Confira a ordem dos horários de entrada e almoço.';
  END IF;$new$
  );
  IF v_updated = v_definition THEN RAISE EXCEPTION 'Não foi possível atualizar a validação de edição do ponto.'; END IF;
  IF position('v_has_lunch := v_turno IN (''turno1'', ''turno2'')' in v_updated) = 0 THEN
    RAISE EXCEPTION 'Não foi possível habilitar o intervalo do 2º turno na edição do ponto.';
  END IF;
  EXECUTE v_updated;
END;
$$;
