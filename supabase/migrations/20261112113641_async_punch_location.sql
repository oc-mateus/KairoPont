-- Register the official time before waiting for the browser's location fix.
-- The short-lived capture ID binds the later result to one uncorrected punch.
CREATE FUNCTION private.normalize_punch_location(p_location jsonb, p_recorded_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_status text := COALESCE(p_location->>'status', 'not_collected');
BEGIN
  IF p_location IS NOT NULL AND pg_catalog.jsonb_typeof(p_location) <> 'object' THEN
    RAISE EXCEPTION 'Localização inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'captured' THEN
    IF pg_catalog.jsonb_typeof(p_location->'latitude') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(p_location->'longitude') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(p_location->'accuracy') IS DISTINCT FROM 'number'
      OR NOT ((p_location->>'latitude')::numeric BETWEEN -90 AND 90)
      OR NOT ((p_location->>'longitude')::numeric BETWEEN -180 AND 180)
      OR NOT ((p_location->>'accuracy')::numeric BETWEEN 0 AND 100000000) THEN
      RAISE EXCEPTION 'Coordenadas ou precisão inválidas.' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'captured',
      'latitude', (p_location->>'latitude')::numeric, 'longitude', (p_location->>'longitude')::numeric,
      'accuracy', (p_location->>'accuracy')::numeric, 'recorded_at', p_recorded_at);
  END IF;
  IF v_status IN ('denied', 'unavailable', 'timeout', 'unsupported', 'not_collected') THEN
    RETURN pg_catalog.jsonb_build_object('status', v_status, 'recorded_at', p_recorded_at);
  END IF;
  RAISE EXCEPTION 'Situação de localização inválida.' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION private.normalize_punch_location(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.registrar_ponto(p_funcionario_id uuid, p_tipo text, p_localizacao jsonb, p_captura_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  v_contract text;
  v_record_id uuid;
  v_location jsonb;
BEGIN
  SELECT tipo_contrato INTO v_contract FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501'; END IF;

  IF p_tipo IN ('entrada', 'saida') THEN
    IF p_captura_id IS NOT NULL THEN
      v_location := pg_catalog.jsonb_build_object(
        'status', 'not_collected', 'recorded_at', pg_catalog.clock_timestamp(), 'captura_id', p_captura_id);
    ELSE
      v_location := private.normalize_punch_location(p_localizacao, pg_catalog.now());
    END IF;
  END IF;

  IF p_tipo = 'saida' THEN
    SELECT id INTO v_record_id FROM public.registros_ponto
    WHERE funcionario_id = p_funcionario_id AND data = v_today AND entrada IS NOT NULL AND saida IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      SELECT id INTO v_record_id FROM public.registros_ponto
      WHERE funcionario_id = p_funcionario_id AND data = v_today - 1 AND entrada IS NOT NULL AND saida IS NULL
        AND (v_contract = 'pj' OR turno_trabalhado = 'turno3') FOR UPDATE;
    END IF;
  END IF;

  PERFORM public.registrar_ponto(p_funcionario_id, p_tipo);
  IF p_tipo = 'entrada' THEN
    UPDATE public.registros_ponto SET entrada_localizacao = v_location
    WHERE funcionario_id = p_funcionario_id AND data = v_today RETURNING id INTO v_record_id;
  ELSIF p_tipo = 'saida' THEN
    UPDATE public.registros_ponto SET saida_localizacao = v_location WHERE id = v_record_id;
  END IF;
  RETURN v_record_id;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text, jsonb, uuid) TO authenticated;

-- Keep the three-argument endpoint available for already-open clients.
CREATE OR REPLACE FUNCTION public.registrar_ponto(p_funcionario_id uuid, p_tipo text, p_localizacao jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.registrar_ponto(p_funcionario_id, p_tipo, p_localizacao, NULL::uuid);
END;
$$;

CREATE FUNCTION public.finalizar_localizacao_ponto(p_registro_id uuid, p_tipo text, p_captura_id uuid, p_localizacao jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pending jsonb;
  v_location jsonb;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('entrada', 'saida') OR p_captura_id IS NULL THEN
    RAISE EXCEPTION 'Identificação da captura inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT CASE p_tipo WHEN 'entrada' THEN p.entrada_localizacao ELSE p.saida_localizacao END
  INTO v_pending FROM public.registros_ponto p
  JOIN public.funcionarios f ON f.id = p.funcionario_id
  WHERE p.id = p_registro_id AND f.auth_id = auth.uid() AND f.ativo = true
  FOR UPDATE OF p;

  -- A correction replaces the original location and invalidates its capture ID.
  IF (v_pending->>'captura_id') IS DISTINCT FROM p_captura_id::text
    OR (v_pending->>'recorded_at')::timestamptz <= pg_catalog.clock_timestamp() - interval '2 minutes' THEN
    RETURN NULL;
  END IF;

  v_location := private.normalize_punch_location(p_localizacao, pg_catalog.clock_timestamp());
  IF p_tipo = 'entrada' THEN
    UPDATE public.registros_ponto SET entrada_localizacao = v_location WHERE id = p_registro_id;
  ELSE
    UPDATE public.registros_ponto SET saida_localizacao = v_location WHERE id = p_registro_id;
  END IF;
  RETURN v_location;
END;
$$;
REVOKE ALL ON FUNCTION public.finalizar_localizacao_ponto(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_localizacao_ponto(uuid, text, uuid, jsonb) TO authenticated;
