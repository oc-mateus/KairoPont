-- Explicit NULL handling prevents SQL's unknown truth value from bypassing
-- the self-demotion and last-administrator guards. No profile data is changed.
ALTER TABLE public.funcionarios
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN ativo SET NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_update_employee(
  p_funcionario_id uuid,
  p_ativo boolean,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_target public.funcionarios%ROWTYPE;
  v_remaining_admins integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_funcionario_id IS NULL OR p_ativo IS NULL OR p_role IS NULL OR p_role NOT IN ('employee', 'admin') THEN
    RAISE EXCEPTION 'Informe funcionário, status e perfil válidos.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(190317, 240001);

  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  SELECT * INTO v_target FROM public.funcionarios WHERE id = p_funcionario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;

  IF v_target.id = v_admin_id AND (p_ativo IS DISTINCT FROM true OR p_role <> 'admin') THEN
    RAISE EXCEPTION 'Não é possível desativar ou rebaixar a própria conta administrativa.';
  END IF;
  IF v_target.role = 'admin' AND v_target.ativo = true
    AND (p_ativo IS DISTINCT FROM true OR p_role <> 'admin') THEN
    SELECT count(*) INTO v_remaining_admins FROM public.funcionarios
    WHERE role = 'admin' AND ativo = true AND id <> v_target.id;
    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'O sistema precisa manter pelo menos um administrador ativo.';
    END IF;
  END IF;

  UPDATE public.funcionarios SET ativo = p_ativo, role = p_role WHERE id = p_funcionario_id;
  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (v_admin_id, 'atualizar_funcionario', p_funcionario_id,
    jsonb_build_object('ativo', p_ativo, 'role', p_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_employee_employment(
  p_funcionario_id uuid,
  p_data_admissao date,
  p_escala_trabalho jsonb,
  p_tipo_contrato text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_funcionario_id IS NULL OR p_tipo_contrato IS NULL OR p_tipo_contrato NOT IN ('clt', 'pj') THEN
    RAISE EXCEPTION 'Tipo de vínculo inválido.';
  END IF;
  IF p_data_admissao IS NOT NULL AND p_data_admissao > public.kairopont_today_sp() THEN
    RAISE EXCEPTION 'Data de admissão inválida.';
  END IF;

  IF p_tipo_contrato = 'clt' THEN
    IF p_data_admissao IS NULL OR p_escala_trabalho IS NULL THEN
      RAISE EXCEPTION 'CLT precisa de data de admissão e escala de trabalho.';
    END IF;
    PERFORM public.admin_update_employee_employment(
      p_funcionario_id, p_data_admissao, p_escala_trabalho
    );
    UPDATE public.funcionarios SET tipo_contrato = 'clt' WHERE id = p_funcionario_id;
  ELSE
    UPDATE public.funcionarios
    SET data_admissao = p_data_admissao,
        escala_trabalho = NULL,
        tipo_contrato = 'pj'
    WHERE id = p_funcionario_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_employee(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee(uuid, boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb, text) TO authenticated;
