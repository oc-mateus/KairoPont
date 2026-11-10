-- Location is collected for every employee at entry/exit. Existing row policies
-- keep it available only to the employee and active administrators.
ALTER TABLE public.registros_ponto
  ADD COLUMN entrada_localizacao jsonb,
  ADD COLUMN saida_localizacao jsonb;

COMMENT ON COLUMN public.registros_ponto.entrada_localizacao IS 'Device coordinates and accuracy, or capture failure status, at entry; not verified GPS evidence.';
COMMENT ON COLUMN public.registros_ponto.saida_localizacao IS 'Device coordinates and accuracy, or capture failure status, at exit; not verified GPS evidence.';

-- Keep the existing clock, schedule and overnight validations unchanged. The
-- three-argument endpoint saves location in the same transaction as the punch.
-- The two-argument endpoint stays available for already-open clients.
CREATE FUNCTION public.registrar_ponto(p_funcionario_id uuid, p_tipo text, p_localizacao jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  v_employee public.funcionarios%ROWTYPE;
  v_record_id uuid;
  v_location jsonb;
  v_status text;
BEGIN
  -- Serialize new requests for this employee, and validate ownership before
  -- inspecting any record or accepting client coordinates.
  SELECT * INTO v_employee FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501'; END IF;

  IF p_tipo IN ('entrada', 'saida') THEN
    IF p_localizacao IS NOT NULL AND pg_catalog.jsonb_typeof(p_localizacao) <> 'object' THEN
      RAISE EXCEPTION 'Localização inválida.' USING ERRCODE = '22023';
    END IF;
    v_status := COALESCE(p_localizacao->>'status', 'not_collected');
    IF v_status = 'captured' THEN
      IF pg_catalog.jsonb_typeof(p_localizacao->'latitude') IS DISTINCT FROM 'number'
        OR pg_catalog.jsonb_typeof(p_localizacao->'longitude') IS DISTINCT FROM 'number'
        OR pg_catalog.jsonb_typeof(p_localizacao->'accuracy') IS DISTINCT FROM 'number'
        OR NOT ((p_localizacao->>'latitude')::numeric BETWEEN -90 AND 90)
        OR NOT ((p_localizacao->>'longitude')::numeric BETWEEN -180 AND 180)
        OR NOT ((p_localizacao->>'accuracy')::numeric BETWEEN 0 AND 100000000) THEN
        RAISE EXCEPTION 'Coordenadas ou precisão inválidas.' USING ERRCODE = '22023';
      END IF;
      -- Whitelist fields. Never trust client timestamps or arbitrary metadata.
      v_location := pg_catalog.jsonb_build_object('status', 'captured',
        'latitude', (p_localizacao->>'latitude')::numeric,
        'longitude', (p_localizacao->>'longitude')::numeric,
        'accuracy', (p_localizacao->>'accuracy')::numeric,
        'recorded_at', pg_catalog.now());
    ELSIF v_status IN ('denied', 'unavailable', 'timeout', 'unsupported', 'not_collected') THEN
      v_location := pg_catalog.jsonb_build_object('status', v_status, 'recorded_at', pg_catalog.now());
    ELSE
      RAISE EXCEPTION 'Situação de localização inválida.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_tipo = 'saida' THEN
    -- Match exactly the current-day / previous-night selection in the original
    -- RPC, before that function closes the open record.
    SELECT id INTO v_record_id FROM public.registros_ponto
    WHERE funcionario_id = p_funcionario_id AND data = v_today AND entrada IS NOT NULL AND saida IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      SELECT id INTO v_record_id FROM public.registros_ponto
      WHERE funcionario_id = p_funcionario_id AND data = v_today - 1 AND entrada IS NOT NULL AND saida IS NULL
        AND (v_employee.tipo_contrato = 'pj' OR turno_trabalhado = 'turno3') FOR UPDATE;
    END IF;
  END IF;

  PERFORM public.registrar_ponto(p_funcionario_id, p_tipo);
  IF p_tipo = 'entrada' THEN
    UPDATE public.registros_ponto SET entrada_localizacao = v_location
    WHERE funcionario_id = p_funcionario_id AND data = v_today;
  ELSIF p_tipo = 'saida' THEN
    UPDATE public.registros_ponto SET saida_localizacao = v_location WHERE id = v_record_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text, jsonb) TO authenticated;

-- A corrected time must not present coordinates from the original time as if
-- they belonged to the corrected punch. New historical rows remain unlocated.
CREATE FUNCTION public.clear_corrected_punch_location()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.entrada IS DISTINCT FROM OLD.entrada THEN
    NEW.entrada_localizacao := CASE WHEN NEW.entrada IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object('status', 'adjusted') END;
  END IF;
  IF OLD.saida IS NOT NULL AND (NEW.saida IS DISTINCT FROM OLD.saida OR NEW.saida_data IS DISTINCT FROM OLD.saida_data) THEN
    NEW.saida_localizacao := CASE WHEN NEW.saida IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object('status', 'adjusted') END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_corrected_punch_location() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clear_corrected_punch_location BEFORE UPDATE ON public.registros_ponto
FOR EACH ROW EXECUTE FUNCTION public.clear_corrected_punch_location();
