CREATE FUNCTION private.apply_punch(p_funcionario_id uuid, p_tipo text, p_time timestamptz, p_expected_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp without time zone := timezone('America/Sao_Paulo', p_time);
  v_data date := (timezone('America/Sao_Paulo', p_time))::date;
  v_hora time := (timezone('America/Sao_Paulo', p_time))::time;
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
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true FOR UPDATE;
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
    INSERT INTO public.registros_ponto (id, funcionario_id, data, entrada, turno_trabalhado)
    VALUES (COALESCE(p_expected_id, pg_catalog.gen_random_uuid()), p_funcionario_id, v_data, v_hora,
      CASE WHEN v_tipo_contrato = 'pj' THEN NULL ELSE v_shift END)
    RETURNING id INTO v_record.id;
    RETURN v_record.id;
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
  IF p_expected_id IS NOT NULL AND (p_expected_id <> v_record.id OR v_now < v_start OR EXISTS (
    SELECT 1 FROM public.registros_ponto AS later
    WHERE later.funcionario_id = p_funcionario_id
      AND (later.data + later.entrada) > v_start AND (later.data + later.entrada) <= v_now
  )) THEN
    RAISE EXCEPTION 'A jornada mudou. Confira a marcação com a administração.';
  END IF;
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
  RETURN v_record.id;
END;
$$;
REVOKE ALL ON FUNCTION private.apply_punch(uuid, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.registrar_ponto(p_funcionario_id uuid, p_tipo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.apply_punch(p_funcionario_id, p_tipo, pg_catalog.now(), NULL);
END;
$$;

CREATE TABLE private.punch_sync_receipts (
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  marcacao_id uuid NOT NULL,
  registro_id uuid NOT NULL,
  tipo text NOT NULL,
  ocorrido_em timestamptz NOT NULL,
  recebido_em timestamptz NOT NULL,
  offline boolean NOT NULL,
  localizacao_finalizada boolean NOT NULL,
  PRIMARY KEY (funcionario_id, marcacao_id)
);
ALTER TABLE private.punch_sync_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.punch_sync_receipts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.sincronizar_marcacao_ponto(
  p_funcionario_id uuid, p_marcacao_id uuid, p_tipo text, p_jornada_id uuid,
  p_ocorrido_em timestamptz, p_localizacao jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_receipt private.punch_sync_receipts%ROWTYPE;
  v_record_id uuid;
  v_record jsonb;
  v_received_at timestamptz := pg_catalog.clock_timestamp();
  v_occurred_at timestamptz := COALESCE(p_ocorrido_em, v_received_at);
  v_location jsonb;
  v_has_location boolean := p_tipo IN ('entrada', 'saida');
  v_location_done boolean;
  v_admission date;
  v_edit_flag text := current_setting('kairopont.allow_historical_punch_edit', true);
BEGIN
  SELECT data_admissao INTO v_admission FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501'; END IF;
  IF p_marcacao_id IS NULL OR p_jornada_id IS NULL OR p_tipo IS NULL
    OR p_tipo NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida')
    OR (p_tipo = 'entrada' AND p_jornada_id <> p_marcacao_id) THEN
    RAISE EXCEPTION 'Identificação da marcação inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_receipt FROM private.punch_sync_receipts
  WHERE funcionario_id = p_funcionario_id AND marcacao_id = p_marcacao_id;
  IF FOUND THEN
    IF p_jornada_id <> v_receipt.registro_id OR p_tipo <> v_receipt.tipo THEN
      RAISE EXCEPTION 'Esta identificação já pertence a outra marcação.' USING ERRCODE = '22023';
    END IF;
    v_record_id := v_receipt.registro_id;
    v_location_done := v_receipt.localizacao_finalizada;
  ELSE
    IF NOT pg_catalog.isfinite(v_occurred_at) OR v_occurred_at > v_received_at + interval '2 minutes' THEN
      RAISE EXCEPTION 'Confira a data e a hora do aparelho. A marcação está no futuro.' USING ERRCODE = '22023';
    END IF;
    IF p_ocorrido_em IS NOT NULL AND (pg_catalog.timezone('America/Sao_Paulo', v_occurred_at))::date < v_admission THEN
      RAISE EXCEPTION 'A marcação está antes da data de admissão.' USING ERRCODE = '22023';
    END IF;
    IF p_ocorrido_em IS NOT NULL THEN
      -- Only fill the next empty field of the identified shift, even after
      -- the regular administrative edit window has expired.
      PERFORM set_config('kairopont.allow_historical_punch_edit', 'on', true);
    END IF;
    v_record_id := private.apply_punch(p_funcionario_id, p_tipo, v_occurred_at, p_jornada_id);
    v_location_done := NOT v_has_location;
    INSERT INTO private.punch_sync_receipts VALUES (
      p_funcionario_id, p_marcacao_id, v_record_id, p_tipo, v_occurred_at, v_received_at,
      p_ocorrido_em IS NOT NULL, v_location_done
    );
    IF p_ocorrido_em IS NOT NULL THEN
      INSERT INTO public.auditoria (acao, alvo_id, detalhes) VALUES (
        'ponto_offline_sincronizado', p_funcionario_id,
        pg_catalog.jsonb_build_object('registro_id', v_record_id, 'tipo', p_tipo,
          'horario_aparelho', v_occurred_at, 'recebido_em', v_received_at)
      );
    END IF;
    IF v_has_location THEN
      v_location := pg_catalog.jsonb_build_object(
        'status', 'not_collected', 'captura_id', p_marcacao_id, 'recorded_at', v_received_at);
      IF p_tipo = 'entrada' THEN
        UPDATE public.registros_ponto SET entrada_localizacao = v_location WHERE id = v_record_id;
      ELSE
        UPDATE public.registros_ponto SET saida_localizacao = v_location WHERE id = v_record_id;
      END IF;
    END IF;
  END IF;

  IF v_has_location AND NOT v_location_done AND p_localizacao IS NOT NULL THEN
    PERFORM set_config('kairopont.allow_historical_punch_edit', 'on', true);
    BEGIN
      v_location := private.normalize_punch_location(p_localizacao, v_received_at);
    EXCEPTION WHEN invalid_parameter_value THEN
      v_location := private.normalize_punch_location('{"status":"unavailable"}'::jsonb, v_received_at);
    END;
    -- A subsequent administrative correction clears the capture ID.
    IF p_tipo = 'entrada' THEN
      UPDATE public.registros_ponto SET entrada_localizacao = v_location
      WHERE id = v_record_id AND entrada_localizacao->>'captura_id' = p_marcacao_id::text;
    ELSE
      UPDATE public.registros_ponto SET saida_localizacao = v_location
      WHERE id = v_record_id AND saida_localizacao->>'captura_id' = p_marcacao_id::text;
    END IF;
    UPDATE private.punch_sync_receipts SET localizacao_finalizada = true
    WHERE funcionario_id = p_funcionario_id AND marcacao_id = p_marcacao_id;
    v_location_done := true;
  END IF;

  PERFORM set_config('kairopont.allow_historical_punch_edit', COALESCE(v_edit_flag, 'off'), true);
  SELECT pg_catalog.to_jsonb(p) INTO v_record FROM public.registros_ponto p
  WHERE p.id = v_record_id AND p.funcionario_id = p_funcionario_id;
  RETURN pg_catalog.jsonb_build_object('registro', v_record, 'localizacao_finalizada', v_location_done OR v_record IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.sincronizar_marcacao_ponto(uuid, uuid, text, uuid, timestamptz, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_marcacao_ponto(uuid, uuid, text, uuid, timestamptz, jsonb)
TO authenticated;
