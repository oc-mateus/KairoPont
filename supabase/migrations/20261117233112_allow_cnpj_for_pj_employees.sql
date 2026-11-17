-- Keep legacy CPF values in place and prevent CNPJ in CLT records and invites.
ALTER TABLE public.funcionarios ADD CONSTRAINT funcionarios_cnpj_apenas_pj CHECK (
  tipo_contrato = 'pj' OR regexp_replace(upper(cpf), '[[:space:]./-]', '', 'g') !~ '^[A-Z0-9]{12}[0-9]{2}$'
);

ALTER TABLE public.funcionario_convites ADD CONSTRAINT funcionario_convites_cnpj_apenas_pj CHECK (
  tipo_contrato = 'pj' OR regexp_replace(upper(cpf), '[[:space:]./-]', '', 'g') !~ '^[A-Z0-9]{12}[0-9]{2}$'
);

-- Replace a PJ's CNPJ with a CPF in the same transaction as the CLT conversion.
CREATE FUNCTION public.admin_update_employee_details(
  p_funcionario_id uuid, p_nome text, p_cargo text, p_data_admissao date,
  p_escala_trabalho jsonb, p_tipo_contrato text, p_suporte boolean, p_cpf text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cpf text := pg_catalog.regexp_replace(p_cpf, '[[:space:]./-]', '', 'g');
  v_length integer;
  v_remainder integer;
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo_contrato IS DISTINCT FROM 'clt' THEN
    RAISE EXCEPTION 'Informe o CPF ao mudar o vínculo de PJ para CLT.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.funcionarios
  WHERE id = p_funcionario_id AND tipo_contrato = 'pj'
    AND pg_catalog.regexp_replace(pg_catalog.upper(cpf), '[[:space:]./-]', '', 'g') ~ '^[A-Z0-9]{12}[0-9]{2}$'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A substituição do documento requer um cadastro PJ com CNPJ.' USING ERRCODE = '22023';
  END IF;

  IF v_cpf IS NULL OR v_cpf !~ '^[0-9]{11}$' OR v_cpf = pg_catalog.repeat(pg_catalog.left(v_cpf, 1), 11) THEN
    RAISE EXCEPTION 'Informe um CPF válido para o vínculo CLT.' USING ERRCODE = '22023';
  END IF;
  FOR v_length IN 9..10 LOOP
    SELECT pg_catalog.sum(pg_catalog.substr(v_cpf, n, 1)::integer * (v_length + 2 - n)) % 11
      INTO v_remainder FROM pg_catalog.generate_series(1, v_length) AS n;
    IF pg_catalog.substr(v_cpf, v_length + 1, 1)::integer <> (CASE WHEN v_remainder < 2 THEN 0 ELSE 11 - v_remainder END) THEN
      RAISE EXCEPTION 'Informe um CPF válido para o vínculo CLT.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.funcionarios SET cpf = v_cpf WHERE id = p_funcionario_id;
  v_result := public.admin_update_employee_details(
    p_funcionario_id, p_nome, p_cargo, p_data_admissao, p_escala_trabalho, p_tipo_contrato, p_suporte
  );
  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes, created_at)
  SELECT id, 'alterar_documento_funcionario', p_funcionario_id,
    pg_catalog.jsonb_build_object('antes', 'CNPJ', 'depois', 'CPF'), pg_catalog.now()
  FROM public.funcionarios WHERE auth_id = auth.uid() AND ativo AND role = 'admin';
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_employee_details(uuid, text, text, date, jsonb, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_details(uuid, text, text, date, jsonb, text, boolean, text)
  TO authenticated;
