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
  IF p_shift IS NULL OR p_shift NOT IN ('turno1', 'turno2', 'turno3') THEN RAISE EXCEPTION 'Turno inválido.'; END IF;
  v_entry := CASE p_shift WHEN 'turno1' THEN '08:00' WHEN 'turno2' THEN '14:00' ELSE '22:45' END;
  v_exit := CASE p_shift WHEN 'turno1' THEN '17:00' WHEN 'turno2' THEN '22:52' ELSE '06:15' END;
  v_saturday_entry := CASE p_shift WHEN 'turno1' THEN '08:00' WHEN 'turno2' THEN '14:30' ELSE '22:45' END;
  -- Saturday shifts account for 44 weekly credited hours after weekday night-hour conversion.
  v_saturday_exit := CASE p_shift WHEN 'turno1' THEN '12:00' WHEN 'turno2' THEN '18:30' ELSE '00:32' END;
  v_lunch_out := CASE p_shift WHEN 'turno1' THEN '12:00' WHEN 'turno2' THEN '19:30' ELSE NULL END;
  v_lunch_return := CASE p_shift WHEN 'turno1' THEN '13:00' WHEN 'turno2' THEN '20:30' ELSE NULL END;
  FOR v_day IN 1..5 LOOP
    v_hours := v_hours || jsonb_build_object(v_day::text, jsonb_build_object(
      'entrada', v_entry, 'saida_almoco', v_lunch_out, 'retorno_almoco', v_lunch_return, 'saida', v_exit));
  END LOOP;
  v_hours := v_hours || jsonb_build_object('6', jsonb_build_object(
    'entrada', v_saturday_entry, 'saida_almoco', NULL, 'retorno_almoco', NULL, 'saida', v_saturday_exit));
  RETURN jsonb_build_object('tipo', p_shift, 'turno_id', p_shift, 'dias_semana', '[1,2,3,4,5,6]'::jsonb, 'horarios_por_dia', v_hours);
END;
$$;
REVOKE ALL ON FUNCTION public.kairopont_schedule_for_shift(text) FROM PUBLIC, anon, authenticated;

UPDATE public.funcionarios
SET escala_trabalho = jsonb_set(
  escala_trabalho,
  '{horarios_por_dia,6}',
  public.kairopont_schedule_for_shift(escala_trabalho->>'turno_id')->'horarios_por_dia'->'6',
  true
)
WHERE escala_trabalho->>'turno_id' IN ('turno2', 'turno3')
  AND jsonb_typeof(escala_trabalho->'horarios_por_dia') = 'object';
