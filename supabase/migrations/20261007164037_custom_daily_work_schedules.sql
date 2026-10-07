-- Permite horários distintos por dia, inclusive jornada contínua sem almoço.
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
  v_day integer;
  v_times jsonb;
  v_entry time;
  v_lunch_out time;
  v_lunch_return time;
  v_exit time;
  v_day_count integer;
  v_unique_day_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_data_admissao IS NULL OR p_data_admissao > current_date
    OR jsonb_typeof(p_escala_trabalho) <> 'object'
    OR jsonb_typeof(p_escala_trabalho->'dias_semana') <> 'array'
    OR jsonb_typeof(p_escala_trabalho->'horarios_por_dia') <> 'object' THEN
    RAISE EXCEPTION 'Data de admissão ou escala de trabalho inválida.';
  END IF;

  SELECT count(*), count(DISTINCT value::text::integer)
  INTO v_day_count, v_unique_day_count
  FROM jsonb_array_elements(p_escala_trabalho->'dias_semana');
  IF v_day_count < 1 OR v_day_count > 7 OR v_day_count <> v_unique_day_count THEN
    RAISE EXCEPTION 'Selecione de um a sete dias de trabalho sem repetição.';
  END IF;

  FOR v_day IN SELECT value::text::integer FROM jsonb_array_elements(p_escala_trabalho->'dias_semana') LOOP
    IF v_day < 1 OR v_day > 7 THEN RAISE EXCEPTION 'Dia da semana inválido.'; END IF;
    v_times := p_escala_trabalho->'horarios_por_dia'->v_day::text;
    IF jsonb_typeof(v_times) <> 'object'
      OR coalesce(v_times->>'entrada', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR coalesce(v_times->>'saida', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Informe entrada e saída válidas para cada dia de trabalho.';
    END IF;
    v_entry := (v_times->>'entrada')::time;
    v_exit := (v_times->>'saida')::time;
    IF v_times->>'saida_almoco' IS NULL AND v_times->>'retorno_almoco' IS NULL THEN
      IF v_exit <= v_entry THEN RAISE EXCEPTION 'A saída precisa ser posterior à entrada.'; END IF;
    ELSIF coalesce(v_times->>'saida_almoco', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND coalesce(v_times->>'retorno_almoco', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      v_lunch_out := (v_times->>'saida_almoco')::time;
      v_lunch_return := (v_times->>'retorno_almoco')::time;
      IF NOT (v_entry < v_lunch_out AND v_lunch_out < v_lunch_return AND v_lunch_return < v_exit) THEN
        RAISE EXCEPTION 'Confira a ordem dos horários de entrada, almoço e saída.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Preencha os dois horários de almoço ou deixe ambos vazios.';
    END IF;
  END LOOP;

  UPDATE public.funcionarios
  SET data_admissao = p_data_admissao, escala_trabalho = p_escala_trabalho
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
  v_registro public.registros_ponto%ROWTYPE;
  v_escala jsonb;
  v_horario_dia jsonb;
  v_dia_iso integer;
  v_tem_intervalo boolean;
BEGIN
  SELECT escala_trabalho INTO v_escala FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501'; END IF;

  v_dia_iso := extract(isodow FROM v_data)::integer;
  v_horario_dia := coalesce(v_escala->'horarios_por_dia'->v_dia_iso::text, v_escala);
  v_tem_intervalo := true;
  IF v_horario_dia ? 'entrada' AND v_horario_dia ? 'saida' THEN
    v_tem_intervalo := nullif(v_horario_dia->>'saida_almoco', '') IS NOT NULL
      AND nullif(v_horario_dia->>'retorno_almoco', '') IS NOT NULL;
  END IF;

  SELECT * INTO v_registro FROM public.registros_ponto
  WHERE funcionario_id = p_funcionario_id AND data = v_data FOR UPDATE;

  IF NOT FOUND THEN
    IF p_tipo <> 'entrada' THEN RAISE EXCEPTION 'A entrada deve ser registrada primeiro.'; END IF;
    INSERT INTO public.registros_ponto (funcionario_id, data, entrada)
    VALUES (p_funcionario_id, v_data, v_hora);
    RETURN;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN RAISE EXCEPTION 'Entrada já registrada hoje.';
    WHEN 'saida_almoco' THEN
      IF NOT v_tem_intervalo THEN RAISE EXCEPTION 'Esta jornada não possui intervalo de almoço hoje.'; END IF;
      IF v_registro.entrada IS NULL OR v_registro.saida_almoco IS NOT NULL THEN RAISE EXCEPTION 'Sequência de ponto inválida.'; END IF;
      UPDATE public.registros_ponto SET saida_almoco = v_hora WHERE id = v_registro.id;
    WHEN 'retorno_almoco' THEN
      IF NOT v_tem_intervalo THEN RAISE EXCEPTION 'Esta jornada não possui intervalo de almoço hoje.'; END IF;
      IF v_registro.saida_almoco IS NULL OR v_registro.retorno_almoco IS NOT NULL THEN RAISE EXCEPTION 'Sequência de ponto inválida.'; END IF;
      UPDATE public.registros_ponto SET retorno_almoco = v_hora WHERE id = v_registro.id;
    WHEN 'saida' THEN
      IF v_tem_intervalo AND v_registro.retorno_almoco IS NULL THEN RAISE EXCEPTION 'Registre o retorno do almoço primeiro.'; END IF;
      IF NOT v_tem_intervalo AND (v_registro.saida_almoco IS NOT NULL OR v_registro.retorno_almoco IS NOT NULL) THEN RAISE EXCEPTION 'Sequência de ponto inválida.'; END IF;
      IF v_registro.entrada IS NULL OR v_registro.saida IS NOT NULL THEN RAISE EXCEPTION 'Sequência de ponto inválida.'; END IF;
      UPDATE public.registros_ponto SET saida = v_hora WHERE id = v_registro.id;
    ELSE RAISE EXCEPTION 'Tipo de registro inválido.';
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text) TO authenticated;
