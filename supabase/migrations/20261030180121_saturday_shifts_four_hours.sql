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
  IF p_shift = 'turno3' THEN
    v_hours := v_hours || jsonb_build_object('6', jsonb_build_object(
      'entrada', '14:00', 'saida_almoco', NULL, 'retorno_almoco', NULL, 'saida', '18:00'));
  ELSE
    v_hours := v_hours || jsonb_build_object('6', jsonb_build_object(
      'entrada', v_entry, 'saida_almoco', NULL, 'retorno_almoco', NULL,
      'saida', to_char((v_entry::time + interval '4 hours')::time, 'HH24:MI')));
  END IF;
  RETURN jsonb_build_object('tipo', p_shift, 'turno_id', p_shift, 'dias_semana', '[1,2,3,4,5,6]'::jsonb, 'horarios_por_dia', v_hours);
END;
$$;
REVOKE ALL ON FUNCTION public.kairopont_schedule_for_shift(text) FROM PUBLIC, anon, authenticated;
