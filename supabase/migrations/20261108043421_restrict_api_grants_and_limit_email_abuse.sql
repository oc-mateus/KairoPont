-- RLS limits rows; explicit grants also limit operations and writable columns.
DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'funcionarios', 'registros_ponto', 'documentos', 'auditoria',
    'funcionario_convites', 'periodos_aquisitivos_ferias',
    'solicitacoes_ferias', 'notificacoes', 'feriados'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    SELECT string_agg(quote_ident(attname), ', ') INTO v_columns
    FROM pg_attribute WHERE attrelid = format('public.%I', v_table)::regclass
      AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_columns, v_table);
  END LOOP;
END;
$$;

GRANT SELECT ON public.funcionarios, public.registros_ponto, public.documentos,
  public.auditoria, public.periodos_aquisitivos_ferias,
  public.solicitacoes_ferias, public.notificacoes TO authenticated;
GRANT UPDATE (nome, cargo, foto_url) ON public.funcionarios TO authenticated;
GRANT UPDATE (lida_em) ON public.notificacoes TO authenticated;
GRANT INSERT (funcionario_id, tipo, nome_arquivo, caminho_storage, periodo_inicio, periodo_fim)
  ON public.documentos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feriados TO authenticated;
GRANT ALL ON public.funcionario_convites TO service_role;

-- Future tables/functions need an intentional grant in their migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- A document cannot reference another employee's file or a nonexistent upload.
DROP POLICY "Funcionário ativo envia somente os próprios documentos" ON public.documentos;
CREATE POLICY "Funcionário ativo envia somente os próprios documentos"
  ON public.documentos FOR INSERT TO authenticated
  WITH CHECK (
    funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo = true
    )
    AND tipo IN ('atestado', 'declaracao_horas')
    AND char_length(nome_arquivo) BETWEEN 1 AND 255
    AND (periodo_inicio IS NULL OR periodo_fim IS NULL OR periodo_fim >= periodo_inicio)
    AND (storage.foldername(caminho_storage))[1] = funcionario_id::text
    AND EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'documentos' AND o.name = caminho_storage
    )
  );

-- Enforce existing UI limits at the server, including direct Storage API calls.
UPDATE storage.buckets SET public = false, file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
WHERE id = 'documentos';
UPDATE storage.buckets SET file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'fotos-funcionarios';

-- Persistent, atomic quotas shared by all Edge workers. No browser access.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE private.edge_rate_limits (
  action text NOT NULL,
  subject text NOT NULL,
  window_seconds integer NOT NULL CHECK (window_seconds > 0),
  window_started_at timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (action, subject, window_seconds)
);
ALTER TABLE private.edge_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.edge_rate_limits FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_edge_rate_limit(p_action text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rule record;
  v_now timestamptz := clock_timestamp();
  v_counter private.edge_rate_limits%ROWTYPE;
  v_retry integer;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('invite-employee', 'vacation-decision-email') THEN
    RAISE EXCEPTION 'Ação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE auth_id = p_actor_id AND ativo = true AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrador ativo não encontrado.' USING ERRCODE = '42501';
  END IF;

  FOR v_rule IN
    SELECT * FROM (VALUES
      (1, p_actor_id::text, 60, CASE WHEN p_action = 'invite-employee' THEN 5 ELSE 10 END),
      (2, p_actor_id::text, 3600, CASE WHEN p_action = 'invite-employee' THEN 30 ELSE 60 END),
      (3, p_actor_id::text, 86400, CASE WHEN p_action = 'invite-employee' THEN 100 ELSE 200 END),
      (4, 'project', 3600, CASE WHEN p_action = 'invite-employee' THEN 60 ELSE 200 END),
      (5, 'project', 86400, CASE WHEN p_action = 'invite-employee' THEN 200 ELSE 500 END)
    ) AS limits(position, subject, seconds, maximum) ORDER BY position
  LOOP
    INSERT INTO private.edge_rate_limits AS counters
      (action, subject, window_seconds, window_started_at, requests)
    VALUES (p_action, v_rule.subject, v_rule.seconds, v_now, 1)
    ON CONFLICT (action, subject, window_seconds) DO UPDATE SET
      window_started_at = CASE
        WHEN counters.window_started_at + make_interval(secs => v_rule.seconds) <= v_now
        THEN v_now ELSE counters.window_started_at END,
      requests = CASE
        WHEN counters.window_started_at + make_interval(secs => v_rule.seconds) <= v_now
        THEN 1 ELSE least(counters.requests + 1, v_rule.maximum + 1) END
    RETURNING * INTO v_counter;

    IF v_counter.requests > v_rule.maximum THEN
      v_retry := greatest(1, ceil(extract(epoch FROM (
        v_counter.window_started_at + make_interval(secs => v_rule.seconds) - v_now
      )))::integer);
      -- Return normally so the counter commits even when the request is denied.
      RETURN jsonb_build_object('allowed', false, 'retry_after', v_retry);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_edge_rate_limit(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_edge_rate_limit(text, uuid) TO service_role;
