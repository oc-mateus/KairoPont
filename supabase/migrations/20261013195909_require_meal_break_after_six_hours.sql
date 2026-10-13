-- Em dias sem almoço fixo, jornadas CLT que ultrapassam seis horas exigem
-- uma pausa registrada de pelo menos uma hora antes da saída.
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
  v_shift text;
  v_shift_distance integer;
  v_entry_minute integer := extract(hour FROM (timezone('America/Sao_Paulo', now())))::integer * 60
    + extract(minute FROM (timezone('America/Sao_Paulo', now())))::integer;
  v_minute integer;
  v_start timestamp without time zone;
  v_lunch_start timestamp without time zone;
  v_lunch_return timestamp without time zone;
  v_has_fixed_lunch boolean;
BEGIN
  SELECT tipo_contrato INTO v_tipo_contrato
  FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501';
  END IF;

  IF p_tipo IS NULL OR (v_tipo_contrato = 'pj' AND p_tipo NOT IN ('entrada', 'saida'))
    OR (v_tipo_contrato = 'clt' AND p_tipo NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida')) THEN
    RAISE EXCEPTION 'Tipo de registro inválido para este vínculo.';
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

  v_start := v_record.data + v_record.entrada;
  v_has_fixed_lunch := v_tipo_contrato = 'clt'
    AND extract(isodow FROM v_record.data) BETWEEN 1 AND 5
    AND v_record.turno_trabalhado IN ('turno1', 'turno2', 'turno3');

  CASE p_tipo
    WHEN 'saida_almoco' THEN
      IF v_tipo_contrato <> 'clt' OR v_has_fixed_lunch THEN
        RAISE EXCEPTION 'Esta jornada usa o almoço fixo do turno.';
      END IF;
      IF v_record.saida_almoco IS NOT NULL OR v_record.retorno_almoco IS NOT NULL THEN
        RAISE EXCEPTION 'A pausa de almoço já foi registrada.';
      END IF;
      IF v_now <= v_start THEN RAISE EXCEPTION 'A saída para almoço precisa ocorrer depois da entrada.'; END IF;
      UPDATE public.registros_ponto SET saida_almoco = v_hora WHERE id = v_record.id;

    WHEN 'retorno_almoco' THEN
      IF v_tipo_contrato <> 'clt' OR v_has_fixed_lunch OR v_record.saida_almoco IS NULL OR v_record.retorno_almoco IS NOT NULL THEN
        RAISE EXCEPTION 'Sequência de ponto inválida para o retorno do almoço.';
      END IF;
      v_lunch_start := v_record.data + v_record.saida_almoco;
      IF v_lunch_start < v_start THEN v_lunch_start := v_lunch_start + interval '1 day'; END IF;
      IF v_now < v_lunch_start + interval '1 hour' THEN
        RAISE EXCEPTION 'A pausa de almoço deve durar pelo menos 1 hora.';
      END IF;
      UPDATE public.registros_ponto SET retorno_almoco = v_hora WHERE id = v_record.id;

    WHEN 'saida' THEN
      IF v_tipo_contrato = 'clt' AND NOT v_has_fixed_lunch THEN
        IF v_record.saida_almoco IS NULL AND v_record.retorno_almoco IS NOT NULL THEN
          RAISE EXCEPTION 'O retorno do almoço não pode existir sem a saída correspondente.';
        END IF;
        IF v_record.saida_almoco IS NOT NULL AND v_record.retorno_almoco IS NULL THEN
          RAISE EXCEPTION 'Registre o retorno do almoço após completar 1 hora de pausa.';
        END IF;
        IF v_record.saida_almoco IS NOT NULL THEN
          v_lunch_start := v_record.data + v_record.saida_almoco;
          IF v_lunch_start < v_start THEN v_lunch_start := v_lunch_start + interval '1 day'; END IF;
          v_lunch_return := v_record.data + v_record.retorno_almoco;
          IF v_lunch_return < v_lunch_start THEN v_lunch_return := v_lunch_return + interval '1 day'; END IF;
          IF v_lunch_return < v_lunch_start + interval '1 hour' THEN
            RAISE EXCEPTION 'A pausa de almoço deve durar pelo menos 1 hora.';
          END IF;
        ELSIF v_now > v_start + interval '6 hours' THEN
          RAISE EXCEPTION 'Jornadas acima de 6 horas exigem uma pausa de almoço de 1 hora.';
        END IF;
      END IF;
      IF v_record.saida IS NOT NULL THEN RAISE EXCEPTION 'Saída já registrada.'; END IF;
      UPDATE public.registros_ponto SET saida = v_hora, saida_data = v_data WHERE id = v_record.id;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text) TO authenticated;

-- Permite corrigir pausas dinâmicas em dias sem almoço fixo e valida a duração.
CREATE OR REPLACE FUNCTION public.admin_edit_punch_record(
  p_record_id uuid,
  p_entrada time,
  p_saida_almoco time,
  p_retorno_almoco time,
  p_saida time,
  p_saida_data date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_record public.registros_ponto%ROWTYPE;
  v_admin_id uuid;
  v_turno text;
  v_weekday integer;
  v_has_fixed_lunch boolean;
  v_requires_fixed_lunch_marks boolean;
  v_work_start timestamp without time zone;
  v_lunch_start timestamp without time zone;
  v_lunch_return timestamp without time zone;
  v_work_end timestamp without time zone;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Administrador ativo não encontrado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_record FROM public.registros_ponto WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de ponto não encontrado.'; END IF;
  IF v_record.created_at IS NULL OR pg_catalog.clock_timestamp() >= v_record.created_at + interval '4 days' THEN
    RAISE EXCEPTION 'Prazo expirado. Este registro está bloqueado para alterações.' USING ERRCODE = '42501';
  END IF;
  IF p_entrada IS NULL THEN RAISE EXCEPTION 'A entrada precisa ter um horário.'; END IF;

  v_turno := public.kairopont_infer_shift(p_entrada);
  v_weekday := extract(isodow FROM v_record.data)::integer;
  v_has_fixed_lunch := v_weekday BETWEEN 1 AND 5 AND v_turno IN ('turno1', 'turno2', 'turno3');
  v_requires_fixed_lunch_marks := v_weekday BETWEEN 1 AND 5 AND v_turno IN ('turno1', 'turno2');
  v_work_start := v_record.data + p_entrada;

  IF (p_saida_almoco IS NULL) <> (p_retorno_almoco IS NULL) THEN
    RAISE EXCEPTION 'Preencha os dois horários de almoço ou deixe ambos vazios.';
  END IF;
  IF v_requires_fixed_lunch_marks AND p_saida_almoco IS NULL THEN
    RAISE EXCEPTION 'Para este turno em dia útil, informe saída e retorno do almoço.';
  END IF;

  IF p_saida_almoco IS NOT NULL THEN
    v_lunch_start := v_record.data + p_saida_almoco;
    IF v_lunch_start < v_work_start THEN v_lunch_start := v_lunch_start + interval '1 day'; END IF;
    v_lunch_return := v_record.data + p_retorno_almoco;
    IF v_lunch_return <= v_lunch_start THEN v_lunch_return := v_lunch_return + interval '1 day'; END IF;
    IF v_lunch_start <= v_work_start THEN
      RAISE EXCEPTION 'A saída para almoço precisa ocorrer depois da entrada.';
    END IF;
    IF NOT v_has_fixed_lunch THEN
      IF v_lunch_return < v_lunch_start + interval '1 hour' THEN
        RAISE EXCEPTION 'A pausa de almoço deve durar pelo menos 1 hora.';
      END IF;
    END IF;
  END IF;

  IF p_saida IS NULL THEN
    IF p_saida_data IS NOT NULL THEN
      RAISE EXCEPTION 'Informe a data da saída somente quando houver horário de saída.';
    END IF;
  ELSE
    IF p_saida_data IS NULL THEN RAISE EXCEPTION 'Informe a data da saída.'; END IF;
    IF v_turno = 'turno3' AND p_saida < p_entrada THEN
      IF p_saida_data IS DISTINCT FROM (v_record.data + 1) THEN
        RAISE EXCEPTION 'A saída antes da entrada no relógio deve ser registrada no dia seguinte.';
      END IF;
    ELSIF p_saida_data IS DISTINCT FROM v_record.data OR p_saida <= p_entrada THEN
      RAISE EXCEPTION 'Confira a data e a ordem do horário de saída.';
    END IF;

    v_work_end := p_saida_data + p_saida;
    IF p_saida_almoco IS NOT NULL AND v_lunch_return >= v_work_end THEN
      RAISE EXCEPTION 'O retorno do almoço precisa ocorrer antes da saída final.';
    END IF;
    IF NOT v_has_fixed_lunch AND p_saida_almoco IS NULL
      AND v_work_end > v_work_start + interval '6 hours' THEN
      RAISE EXCEPTION 'Jornadas acima de 6 horas exigem uma pausa de almoço de 1 hora.';
    END IF;
  END IF;

  UPDATE public.registros_ponto
  SET entrada = p_entrada,
      saida_almoco = p_saida_almoco,
      retorno_almoco = p_retorno_almoco,
      saida = p_saida,
      saida_data = p_saida_data,
      turno_trabalhado = v_turno
  WHERE id = p_record_id;

  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (
    v_admin_id,
    'editar_registro_ponto',
    v_record.funcionario_id,
    jsonb_build_object(
      'registro_id', p_record_id,
      'antes', jsonb_build_object('entrada', v_record.entrada, 'saida_almoco', v_record.saida_almoco, 'retorno_almoco', v_record.retorno_almoco, 'saida', v_record.saida, 'saida_data', v_record.saida_data, 'turno_trabalhado', v_record.turno_trabalhado),
      'depois', jsonb_build_object('entrada', p_entrada, 'saida_almoco', p_saida_almoco, 'retorno_almoco', p_retorno_almoco, 'saida', p_saida, 'saida_data', p_saida_data, 'turno_trabalhado', v_turno)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_edit_punch_record(uuid, time, time, time, time, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_punch_record(uuid, time, time, time, time, date) TO authenticated;
