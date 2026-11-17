CREATE TABLE public.contratos_pj (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 3 AND 120),
  referencia text CHECK (char_length(referencia) <= 80),
  descricao text CHECK (char_length(descricao) <= 600),
  prazo date,
  created_at timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  concluido_em timestamptz,
  concluido_por uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL
);

CREATE TABLE public.contratos_pj_participantes (
  contrato_id uuid NOT NULL REFERENCES public.contratos_pj(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  PRIMARY KEY (contrato_id, funcionario_id)
);

CREATE INDEX contratos_pj_participantes_funcionario_idx
  ON public.contratos_pj_participantes (funcionario_id, contrato_id);
CREATE INDEX contratos_pj_concluido_por_idx ON public.contratos_pj (concluido_por);

ALTER TABLE public.contratos_pj ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos_pj_participantes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.contratos_pj, public.contratos_pj_participantes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contratos_pj, public.contratos_pj_participantes TO authenticated;

CREATE POLICY contratos_pj_participantes_leitura ON public.contratos_pj_participantes
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR funcionario_id IN (
      SELECT id FROM public.funcionarios
      WHERE auth_id = (SELECT auth.uid()) AND ativo IS TRUE AND tipo_contrato = 'pj'
    )
  );

CREATE POLICY contratos_pj_leitura ON public.contratos_pj
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR id IN (SELECT contrato_id FROM public.contratos_pj_participantes)
  );

CREATE FUNCTION public.salvar_contrato_pj(
  p_id uuid, p_versao integer, p_nome text, p_referencia text,
  p_descricao text, p_prazo date, p_participantes uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_contrato public.contratos_pj%ROWTYPE;
  v_anteriores uuid[];
  v_nome text := pg_catalog.btrim(p_nome);
  v_referencia text := nullif(pg_catalog.btrim(p_referencia), '');
  v_descricao text := nullif(pg_catalog.btrim(p_descricao), '');
BEGIN
  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operação restrita à administração.' USING ERRCODE = '42501';
  END IF;

  IF v_nome IS NULL OR pg_catalog.char_length(v_nome) NOT BETWEEN 3 AND 120
    OR pg_catalog.char_length(v_referencia) > 80 OR pg_catalog.char_length(v_descricao) > 600 THEN
    RAISE EXCEPTION 'Confira o nome, a referência e a descrição do contrato.';
  END IF;
  IF p_participantes IS NULL OR pg_catalog.array_position(p_participantes, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Selecione participantes válidos.';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_contrato FROM public.contratos_pj WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.'; END IF;
    IF v_contrato.versao IS DISTINCT FROM p_versao THEN
      RAISE EXCEPTION 'O contrato foi atualizado. Abra a edição novamente.' USING ERRCODE = '40001';
    END IF;
    IF v_contrato.concluido_em IS NOT NULL THEN
      RAISE EXCEPTION 'Reabra o projeto antes de editar.';
    END IF;
  END IF;

  SELECT ARRAY(
    SELECT funcionario_id FROM public.contratos_pj_participantes
    WHERE contrato_id = p_id ORDER BY funcionario_id
  ) INTO v_anteriores;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_participantes) AS participante(id)
    WHERE NOT (participante.id = ANY(v_anteriores))
      AND NOT EXISTS (
        SELECT 1 FROM public.funcionarios
        WHERE id = participante.id AND ativo IS TRUE AND tipo_contrato = 'pj' AND role = 'employee'
      )
  ) THEN
    RAISE EXCEPTION 'Novos participantes precisam ser funcionários PJ ativos.';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.contratos_pj (nome, referencia, descricao, prazo)
    VALUES (v_nome, v_referencia, v_descricao, p_prazo) RETURNING * INTO v_contrato;
  ELSE
    UPDATE public.contratos_pj SET nome = v_nome, referencia = v_referencia,
      descricao = v_descricao, prazo = p_prazo, versao = versao + 1
    WHERE id = p_id RETURNING * INTO v_contrato;
  END IF;

  DELETE FROM public.contratos_pj_participantes
  WHERE contrato_id = v_contrato.id AND NOT (funcionario_id = ANY(p_participantes));

  INSERT INTO public.contratos_pj_participantes (contrato_id, funcionario_id)
  SELECT v_contrato.id, id FROM pg_catalog.unnest(p_participantes) AS participante(id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.auditoria (admin_id, acao, detalhes, created_at)
  VALUES (
    v_admin_id, CASE WHEN p_id IS NULL THEN 'criar_contrato_pj' ELSE 'editar_contrato_pj' END,
    pg_catalog.jsonb_build_object('contrato_id', v_contrato.id, 'contrato', v_contrato.nome,
      'participantes_anteriores', v_anteriores, 'participantes', p_participantes), now()
  );
  RETURN v_contrato.id;
END;
$$;

CREATE FUNCTION public.atualizar_conclusao_contrato_pj(p_id uuid, p_versao integer, p_concluir boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ator public.funcionarios%ROWTYPE;
  v_contrato public.contratos_pj%ROWTYPE;
  v_admin boolean;
BEGIN
  SELECT * INTO v_ator FROM public.funcionarios WHERE auth_id = auth.uid() AND ativo IS TRUE;
  IF NOT FOUND OR p_concluir IS NULL THEN
    RAISE EXCEPTION 'Você não tem acesso a esta operação.' USING ERRCODE = '42501';
  END IF;
  v_admin := v_ator.role IS NOT DISTINCT FROM 'admin';

  SELECT * INTO v_contrato FROM public.contratos_pj WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (NOT v_admin AND (
    NOT p_concluir OR v_ator.tipo_contrato IS DISTINCT FROM 'pj'
    OR NOT EXISTS (
      SELECT 1 FROM public.contratos_pj_participantes
      WHERE contrato_id = p_id AND funcionario_id = v_ator.id
    )
  )) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta operação.' USING ERRCODE = '42501';
  END IF;

  IF p_concluir = (v_contrato.concluido_em IS NOT NULL) THEN RETURN; END IF;
  IF v_contrato.versao IS DISTINCT FROM p_versao THEN
    RAISE EXCEPTION 'O contrato foi atualizado. Confira os dados e tente novamente.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.contratos_pj
  SET concluido_em = CASE WHEN p_concluir THEN now() END,
    concluido_por = CASE WHEN p_concluir THEN v_ator.id END,
    versao = versao + 1
  WHERE id = p_id;

  INSERT INTO public.auditoria (admin_id, acao, detalhes, created_at)
  VALUES (
    CASE WHEN v_admin THEN v_ator.id END,
    CASE WHEN p_concluir THEN 'concluir_contrato_pj' ELSE 'reabrir_contrato_pj' END,
    pg_catalog.jsonb_build_object('contrato_id', p_id, 'contrato', v_contrato.nome,
      'ator_id', v_ator.id, 'ator_nome', v_ator.nome), now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_contrato_pj(uuid, integer, text, text, text, date, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atualizar_conclusao_contrato_pj(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_contrato_pj(uuid, integer, text, text, text, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_conclusao_contrato_pj(uuid, integer, boolean) TO authenticated;

CREATE FUNCTION public.get_timesheet_report(p_funcionario_id uuid, p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'emitido_em', pg_catalog.statement_timestamp(),
    'registros', coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(registro) ORDER BY registro.data, registro.id), '[]'::jsonb)
  )
  FROM public.registros_ponto AS registro
  WHERE registro.funcionario_id = p_funcionario_id AND registro.data BETWEEN p_inicio AND p_fim;
$$;

REVOKE ALL ON FUNCTION public.get_timesheet_report(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_timesheet_report(uuid, date, date) TO authenticated;
