-- Use actual entry minutes against rounded expected starts. If the closest
-- standard schedule is closer than an employee's saved template, retain the
-- real schedule classification rather than assigning an impossible lunch.
CREATE OR REPLACE FUNCTION public.kairopont_infer_employee_schedule(p_schedule jsonb, p_entry time)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_expected record;
  v_actual integer := extract(hour FROM p_entry)::integer * 60 + extract(minute FROM p_entry)::integer;
  v_expected_minute integer;
  v_best_shift text;
  v_best_distance integer := 1441;
  v_distance integer;
  v_global_shift text;
  v_global_minute integer;
  v_global_distance integer;
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

  v_global_shift := public.kairopont_infer_shift(p_entry);
  v_global_minute := CASE v_global_shift WHEN 'turno1' THEN 360 WHEN 'turno2' THEN 480 ELSE 840 END;
  v_global_distance := LEAST(ABS(v_actual - v_global_minute), 1440 - ABS(v_actual - v_global_minute));
  IF v_best_shift IS NULL OR v_global_distance < v_best_distance THEN RETURN v_global_shift; END IF;
  RETURN v_best_shift;
END;
$$;

SELECT pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'on', true);
UPDATE public.registros_ponto r
SET turno_trabalhado = public.kairopont_infer_employee_schedule(f.escala_trabalho, r.entrada)
FROM public.funcionarios f
WHERE f.id = r.funcionario_id AND r.entrada IS NOT NULL;
SELECT pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'off', true);
