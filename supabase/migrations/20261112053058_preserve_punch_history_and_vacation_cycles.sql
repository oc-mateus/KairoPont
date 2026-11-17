-- Freeze the reporting baseline for legacy rows. Capture later changes so a
-- new historical entry can use the contract in effect at its recorded time.
ALTER TABLE public.registros_ponto ADD COLUMN tipo_contrato text;

DO $$
BEGIN
  PERFORM pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'on', true);
  UPDATE public.registros_ponto p SET tipo_contrato = f.tipo_contrato
  FROM public.funcionarios f WHERE f.id = p.funcionario_id;
  PERFORM pg_catalog.set_config('kairopont.allow_historical_punch_edit', 'off', true);
END;
$$;

ALTER TABLE public.registros_ponto ADD CONSTRAINT registros_ponto_tipo_contrato_check
  CHECK (tipo_contrato IN ('clt', 'pj'));

CREATE TABLE private.punch_contract_history (
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  vigente_desde timestamptz NOT NULL,
  tipo_contrato text NOT NULL CHECK (tipo_contrato IN ('clt', 'pj')),
  PRIMARY KEY (funcionario_id, vigente_desde)
);
ALTER TABLE private.punch_contract_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.punch_contract_history FROM PUBLIC, anon, authenticated;

INSERT INTO private.punch_contract_history (funcionario_id, vigente_desde, tipo_contrato)
SELECT id, '-infinity', tipo_contrato FROM public.funcionarios;

CREATE FUNCTION private.remember_punch_contract() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tipo_contrato IS NOT DISTINCT FROM OLD.tipo_contrato THEN RETURN NEW; END IF;
  INSERT INTO private.punch_contract_history (funcionario_id, vigente_desde, tipo_contrato)
  VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN '-infinity'::timestamptz ELSE pg_catalog.clock_timestamp() END, NEW.tipo_contrato)
  ON CONFLICT (funcionario_id, vigente_desde) DO UPDATE SET tipo_contrato = excluded.tipo_contrato;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.remember_punch_contract() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER remember_punch_contract AFTER INSERT OR UPDATE OF tipo_contrato ON public.funcionarios
FOR EACH ROW EXECUTE FUNCTION private.remember_punch_contract();

CREATE FUNCTION private.snapshot_punch_contract() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.funcionarios WHERE id = NEW.funcionario_id FOR SHARE;
  SELECT h.tipo_contrato INTO NEW.tipo_contrato
  FROM private.punch_contract_history h
  WHERE h.funcionario_id = NEW.funcionario_id
    AND h.vigente_desde <= (NEW.data + coalesce(NEW.entrada, time '00:00')) AT TIME ZONE 'America/Sao_Paulo'
  ORDER BY h.vigente_desde DESC LIMIT 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.snapshot_punch_contract() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER snapshot_punch_contract BEFORE INSERT ON public.registros_ponto
FOR EACH ROW EXECUTE FUNCTION private.snapshot_punch_contract();

-- Expose only holiday dates relevant to the caller's recorded punches.
CREATE FUNCTION public.list_punch_holiday_dates(p_start date, p_end date)
RETURNS TABLE (data date) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT h.data
  FROM public.feriados h
  JOIN public.registros_ponto p ON p.data = h.data
  JOIN public.funcionarios f ON f.id = p.funcionario_id
  WHERE h.data BETWEEN p_start AND p_end AND f.auth_id = (SELECT auth.uid()) AND f.ativo = true
  ORDER BY h.data
$$;
REVOKE ALL ON FUNCTION public.list_punch_holiday_dates(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_punch_holiday_dates(date, date) TO authenticated;

-- Archive only unused cycles. Decisions, requests and explicit abono choices
-- keep their original cycle and prevent regeneration of an overlapping one.
ALTER TABLE public.periodos_aquisitivos_ferias ADD COLUMN substituido_em timestamptz;

CREATE FUNCTION private.archive_unused_vacation_cycles(p_employee uuid, p_admission date)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Lock first so the following statement sees requests committed while waiting.
  PERFORM 1 FROM public.periodos_aquisitivos_ferias
  WHERE funcionario_id = p_employee AND substituido_em IS NULL ORDER BY id FOR UPDATE;
  UPDATE public.periodos_aquisitivos_ferias p SET substituido_em = pg_catalog.now()
  WHERE p.funcionario_id = p_employee AND p.substituido_em IS NULL
    AND p.dias_abono = 0 AND p.abono_solicitado_em IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.solicitacoes_ferias r WHERE r.periodo_id = p.id)
    AND (p_admission IS NULL OR p.periodo_inicio < p_admission
      OR p.periodo_inicio <> (p_admission + pg_catalog.make_interval(years =>
        (extract(year FROM p.periodo_inicio) - extract(year FROM p_admission))::integer))::date
      OR EXISTS (
        SELECT 1 FROM public.periodos_aquisitivos_ferias retained
        WHERE retained.funcionario_id = p_employee AND retained.id <> p.id AND retained.substituido_em IS NULL
          AND retained.periodo_inicio <= p.periodo_fim AND retained.periodo_fim >= p.periodo_inicio
          AND (retained.dias_abono <> 0 OR retained.abono_solicitado_em IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.solicitacoes_ferias r WHERE r.periodo_id = retained.id))
      ));
END;
$$;
REVOKE ALL ON FUNCTION private.archive_unused_vacation_cycles(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.reconcile_vacation_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.archive_unused_vacation_cycles(NEW.id, NEW.data_admissao);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.reconcile_vacation_admission() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reconcile_vacation_admission AFTER UPDATE OF data_admissao, tipo_contrato ON public.funcionarios
FOR EACH ROW WHEN (NEW.tipo_contrato = 'clt' AND (
  OLD.data_admissao IS DISTINCT FROM NEW.data_admissao OR OLD.tipo_contrato IS DISTINCT FROM NEW.tipo_contrato
))
EXECUTE FUNCTION private.reconcile_vacation_admission();

SELECT private.archive_unused_vacation_cycles(id, data_admissao)
FROM public.funcionarios WHERE tipo_contrato = 'clt';

CREATE FUNCTION private.require_current_vacation_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_archived timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'solicitacoes_ferias' THEN
    SELECT substituido_em INTO v_archived FROM public.periodos_aquisitivos_ferias
    WHERE id = NEW.periodo_id FOR UPDATE;
  ELSE
    v_archived := OLD.substituido_em;
  END IF;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'Este período foi substituído após a correção da admissão.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_current_vacation_cycle() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER require_current_vacation_cycle BEFORE INSERT ON public.solicitacoes_ferias
FOR EACH ROW EXECUTE FUNCTION private.require_current_vacation_cycle();
CREATE TRIGGER require_current_vacation_cycle BEFORE UPDATE OF dias_abono, abono_solicitado_em
ON public.periodos_aquisitivos_ferias FOR EACH ROW EXECUTE FUNCTION private.require_current_vacation_cycle();

CREATE OR REPLACE FUNCTION public.sync_current_vacation_periods() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_employee record;
  v_cycle integer;
  v_period_start date;
  v_period_end date;
  v_due date;
  v_today date := public.kairopont_today_sp();
  v_auth uuid := auth.uid();
  v_admin boolean := public.is_admin();
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501'; END IF;
  IF NOT v_admin AND NOT EXISTS (
    SELECT 1 FROM public.funcionarios WHERE auth_id = v_auth AND ativo AND tipo_contrato = 'clt'
  ) THEN RAISE EXCEPTION 'Funcionário CLT ativo não encontrado.' USING ERRCODE = '42501'; END IF;

  FOR v_employee IN
    SELECT id, data_admissao FROM public.funcionarios
    WHERE ativo AND tipo_contrato = 'clt' AND data_admissao IS NOT NULL
      AND (v_admin OR auth_id = v_auth)
    ORDER BY id FOR NO KEY UPDATE
  LOOP
    FOR v_cycle IN 0..greatest(extract(year FROM pg_catalog.age(v_today, v_employee.data_admissao))::integer, 0)
    LOOP
      v_period_start := (v_employee.data_admissao + pg_catalog.make_interval(years => v_cycle))::date;
      v_period_end := (v_period_start + interval '1 year' - interval '1 day')::date;
      v_due := (v_period_start + interval '2 years' - interval '1 day')::date;
      INSERT INTO public.periodos_aquisitivos_ferias (funcionario_id, periodo_inicio, periodo_fim, prazo_concessivo)
      SELECT v_employee.id, v_period_start, v_period_end, v_due
      WHERE NOT EXISTS (
        SELECT 1 FROM public.periodos_aquisitivos_ferias p
        WHERE p.funcionario_id = v_employee.id AND p.substituido_em IS NULL
          AND p.periodo_inicio <= v_period_end AND p.periodo_fim >= v_period_start
      )
      ON CONFLICT (funcionario_id, periodo_inicio) DO UPDATE
        SET substituido_em = NULL, periodo_fim = excluded.periodo_fim, prazo_concessivo = excluded.prazo_concessivo
        WHERE periodos_aquisitivos_ferias.substituido_em IS NOT NULL;
    END LOOP;
  END LOOP;

  INSERT INTO public.notificacoes (funcionario_id, tipo, titulo, mensagem, referencia)
  SELECT p.funcionario_id,
    CASE WHEN p.prazo_concessivo < v_today THEN 'ferias_vencidas' ELSE 'ferias_vencimento_proximo' END,
    CASE WHEN p.prazo_concessivo < v_today THEN 'Prazo de férias vencido' ELSE 'Prazo de férias próximo' END,
    CASE WHEN p.prazo_concessivo < v_today
      THEN 'O prazo concessivo do período iniciado em ' || pg_catalog.to_char(p.periodo_inicio, 'DD/MM/YYYY') || ' terminou em ' || pg_catalog.to_char(p.prazo_concessivo, 'DD/MM/YYYY') || '. Procure o administrador.'
      ELSE 'O prazo concessivo do período iniciado em ' || pg_catalog.to_char(p.periodo_inicio, 'DD/MM/YYYY') || ' termina em ' || pg_catalog.to_char(p.prazo_concessivo, 'DD/MM/YYYY') || '.'
    END,
    CASE WHEN p.prazo_concessivo < v_today THEN 'ferias-vencidas:' ELSE 'ferias-prazo:' END || p.id::text
  FROM public.periodos_aquisitivos_ferias p
  JOIN public.funcionarios f ON f.id = p.funcionario_id
  WHERE p.substituido_em IS NULL AND f.ativo AND f.tipo_contrato = 'clt'
    AND (v_admin OR f.auth_id = v_auth) AND p.prazo_concessivo <= v_today + 60
    AND NOT EXISTS (SELECT 1 FROM public.solicitacoes_ferias r WHERE r.periodo_id = p.id AND r.status = 'aprovada')
  ON CONFLICT (referencia) DO NOTHING;
END;
$$;

-- Only retired avatar paths in the caller's own folder may be deleted.
CREATE POLICY "Funcionário remove suas fotos de perfil substituídas"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'fotos-funcionarios'
    AND name ~ '^[0-9a-f-]{36}/foto(-[0-9a-f-]{36})?\.(jpg|jpeg|png|webp)$'
    AND EXISTS (
      SELECT 1 FROM public.funcionarios f
      WHERE f.auth_id = (SELECT auth.uid()) AND f.ativo
        AND f.id::text = (storage.foldername(name))[1]
        AND pg_catalog.split_part(coalesce(f.foto_url, ''), '?', 1)
          NOT LIKE '%/storage/v1/object/public/fotos-funcionarios/' || objects.name
    )
  );
