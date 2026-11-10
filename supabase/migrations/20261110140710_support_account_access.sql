ALTER TABLE public.funcionarios ADD COLUMN suporte boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.is_support()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.funcionarios
    WHERE auth_id=auth.uid() AND ativo=true AND suporte=true);
$$;
REVOKE ALL ON FUNCTION public.is_support() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_support() TO authenticated;

-- Preserve the six-argument editor for already-open clients. Only administrators
-- may grant support access; the grant and registration edit share a transaction.
CREATE FUNCTION public.admin_update_employee_details(
  p_funcionario_id uuid,p_nome text,p_cargo text,p_data_admissao date,
  p_escala_trabalho jsonb,p_tipo_contrato text,p_suporte boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before boolean; v_admin uuid; v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE='42501';
  END IF;
  IF p_suporte IS NULL THEN RAISE EXCEPTION 'Informe o acesso ao suporte.' USING ERRCODE='22023'; END IF;
  SELECT suporte INTO v_before FROM public.funcionarios WHERE id=p_funcionario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;
  PERFORM public.admin_update_employee_details(p_funcionario_id,p_nome,p_cargo,p_data_admissao,p_escala_trabalho,p_tipo_contrato);
  UPDATE public.funcionarios SET suporte=p_suporte WHERE id=p_funcionario_id;
  IF v_before IS DISTINCT FROM p_suporte THEN
    SELECT id INTO v_admin FROM public.funcionarios WHERE auth_id=auth.uid() AND ativo=true AND role='admin';
    INSERT INTO public.auditoria(admin_id,acao,alvo_id,detalhes,created_at)
    VALUES(v_admin,'alterar_acesso_suporte',p_funcionario_id,
      jsonb_build_object('antes',v_before,'depois',p_suporte),now());
  END IF;
  SELECT to_jsonb(f) INTO v_result FROM public.funcionarios f WHERE id=p_funcionario_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_employee_details(uuid,text,text,date,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_details(uuid,text,text,date,jsonb,text,boolean) TO authenticated;
