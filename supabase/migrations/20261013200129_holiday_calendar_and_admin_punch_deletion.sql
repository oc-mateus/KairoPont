-- Calendário de feriados e exclusão administrativa auditada de registros de ponto.

CREATE TABLE public.feriados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL UNIQUE,
  nome text NOT NULL CHECK (length(trim(nome)) > 0),
  abrangencia text NOT NULL DEFAULT 'empresa'
    CHECK (abrangencia IN ('nacional', 'estadual', 'municipal', 'empresa')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feriados TO authenticated;

CREATE POLICY "Administradores gerenciam calendário de feriados"
  ON public.feriados FOR ALL TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- 12 de outubro de 2026, Nossa Senhora Aparecida (feriado nacional).
INSERT INTO public.feriados (data, nome, abrangencia)
VALUES ('2026-10-12', 'Nossa Senhora Aparecida', 'nacional')
ON CONFLICT (data) DO NOTHING;

-- A janela de quatro dias continua protegendo edições. Exclusões são feitas
-- exclusivamente pela RPC administrativa, que registra o conteúdo removido.
CREATE OR REPLACE FUNCTION public.prevent_late_punch_record_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.is_admin() THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.funcionario_id IS DISTINCT FROM OLD.funcionario_id
    OR NEW.data IS DISTINCT FROM OLD.data
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'A identificação e a data-base do registro não podem ser alteradas.' USING ERRCODE = '42501';
  END IF;

  IF OLD.created_at IS NULL OR pg_catalog.clock_timestamp() >= OLD.created_at + interval '4 days' THEN
    RAISE EXCEPTION 'Prazo expirado. Este registro está bloqueado para alterações.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_punch_record(p_record_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_record public.registros_ponto%ROWTYPE;
  v_admin_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_id
  FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Administrador ativo não encontrado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_record
  FROM public.registros_ponto
  WHERE id = p_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de ponto não encontrado.';
  END IF;

  DELETE FROM public.registros_ponto WHERE id = p_record_id;

  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (
    v_admin_id,
    'excluir_registro_ponto',
    v_record.funcionario_id,
    jsonb_build_object(
      'registro_id', v_record.id,
      'data', v_record.data,
      'entrada', v_record.entrada,
      'saida_almoco', v_record.saida_almoco,
      'retorno_almoco', v_record.retorno_almoco,
      'saida', v_record.saida,
      'saida_data', v_record.saida_data,
      'turno_trabalhado', v_record.turno_trabalhado,
      'created_at', v_record.created_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_punch_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_punch_record(uuid) TO authenticated;
