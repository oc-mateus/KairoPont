-- Keep registration changes atomic and available only to active administrators.
CREATE OR REPLACE FUNCTION public.admin_update_employee_details(
  p_funcionario_id uuid,
  p_nome text,
  p_cargo text,
  p_data_admissao date,
  p_escala_trabalho jsonb,
  p_tipo_contrato text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_before public.funcionarios%ROWTYPE;
  v_after public.funcionarios%ROWTYPE;
  v_nome text := pg_catalog.btrim(p_nome);
  v_cargo text := pg_catalog.btrim(p_cargo);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Administrador ativo não encontrado.' USING ERRCODE = '42501';
  END IF;
  IF v_nome IS NULL OR pg_catalog.char_length(v_nome) NOT BETWEEN 3 AND 160 THEN
    RAISE EXCEPTION 'Informe um nome com 3 a 160 caracteres.';
  END IF;
  IF v_cargo IS NULL OR pg_catalog.char_length(v_cargo) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Informe um cargo com até 120 caracteres.';
  END IF;
  IF p_tipo_contrato IS NULL OR p_tipo_contrato NOT IN ('clt', 'pj') THEN
    RAISE EXCEPTION 'Tipo de vínculo inválido.';
  END IF;

  SELECT * INTO v_before FROM public.funcionarios WHERE id = p_funcionario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;

  -- Reuse the existing CLT/PJ admission and schedule validation.
  PERFORM public.admin_update_employee_employment(
    p_funcionario_id, p_data_admissao, p_escala_trabalho, p_tipo_contrato
  );
  UPDATE public.funcionarios SET nome = v_nome, cargo = v_cargo
  WHERE id = p_funcionario_id RETURNING * INTO v_after;

  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes, created_at)
  VALUES (v_admin_id, 'atualizar_cadastro_funcionario', p_funcionario_id,
    pg_catalog.jsonb_build_object(
      'antes', pg_catalog.jsonb_build_object('nome', v_before.nome, 'cargo', v_before.cargo,
        'tipo_contrato', v_before.tipo_contrato, 'data_admissao', v_before.data_admissao,
        'escala_trabalho', v_before.escala_trabalho),
      'depois', pg_catalog.jsonb_build_object('nome', v_after.nome, 'cargo', v_after.cargo,
        'tipo_contrato', v_after.tipo_contrato, 'data_admissao', v_after.data_admissao,
        'escala_trabalho', v_after.escala_trabalho)
    ), pg_catalog.now());
  RETURN pg_catalog.to_jsonb(v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_employee_details(uuid, text, text, date, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_details(uuid, text, text, date, jsonb, text) TO authenticated;
