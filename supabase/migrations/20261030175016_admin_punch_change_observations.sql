CREATE OR REPLACE FUNCTION public.admin_edit_punch_record(
  p_record_id uuid,
  p_entrada time,
  p_saida_almoco time,
  p_retorno_almoco time,
  p_saida time,
  p_saida_data date,
  p_observacao text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_record public.registros_ponto%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501'; END IF;
  IF pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_observacao, ''))) < 10 THEN
    RAISE EXCEPTION 'Informe uma observação com pelo menos 10 caracteres.';
  END IF;
  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Administrador ativo não encontrado.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_record FROM public.registros_ponto WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de ponto não encontrado.'; END IF;

  PERFORM public.admin_edit_punch_record(
    p_record_id, p_entrada, p_saida_almoco, p_retorno_almoco, p_saida, p_saida_data
  );
  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (v_admin_id, 'observacao_edicao_registro_ponto', v_record.funcionario_id,
    jsonb_build_object('registro_id', p_record_id, 'observacao', pg_catalog.btrim(p_observacao)));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_edit_punch_record(uuid, time, time, time, time, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_punch_record(uuid, time, time, time, time, date, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_edit_punch_record(uuid, time, time, time, time, date) FROM authenticated;
