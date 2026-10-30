-- Match an entry against any of the employee's habitual starts, rounded to
-- the nearest full hour. Keep reading older per-day values during migration.
CREATE OR REPLACE FUNCTION public.kairopont_infer_employee_schedule(p_schedule jsonb, p_entry time)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_expected record;
  v_schedules jsonb := '[]'::jsonb;
  v_actual integer := mod(((extract(hour FROM p_entry)::integer * 60 + extract(minute FROM p_entry)::integer + 30) / 60) * 60, 1440);
  v_expected_minute integer;
  v_best_shift text;
  v_best_distance integer := 1441;
  v_distance integer;
  v_global_shift text;
  v_global_minute integer;
  v_global_distance integer;
BEGIN
  IF p_entry IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_schedule->'horarios_habituais') = 'array' THEN
    IF jsonb_array_length(p_schedule->'horarios_habituais') > 0 THEN
      v_schedules := p_schedule->'horarios_habituais';
    END IF;
  ELSIF jsonb_typeof(p_schedule->'horarios_por_dia') = 'object' THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
    INTO v_schedules
    FROM jsonb_each(p_schedule->'horarios_por_dia')
    WHERE value->>'entrada' IS NOT NULL;
  END IF;

  FOR v_expected IN
    SELECT value->>'entrada' AS entry_time FROM jsonb_array_elements(v_schedules)
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

-- Accept the new reusable list while continuing to tolerate clients that
-- still submit the legacy per-day schedule object.
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
    OR p_escala_trabalho IS NULL
    OR NOT (
      (CASE WHEN jsonb_typeof(p_escala_trabalho->'horarios_habituais') = 'array'
        THEN jsonb_array_length(p_escala_trabalho->'horarios_habituais') > 0 ELSE false END)
      OR jsonb_typeof(p_escala_trabalho->'horarios_por_dia') = 'object'
    )
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
