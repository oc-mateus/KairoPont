CREATE OR REPLACE FUNCTION public.prevent_late_punch_record_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
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
REVOKE ALL ON FUNCTION public.prevent_late_punch_record_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_late_punch_record_changes ON public.registros_ponto;
CREATE TRIGGER prevent_late_punch_record_changes
  BEFORE UPDATE OR DELETE ON public.registros_ponto
  FOR EACH ROW EXECUTE FUNCTION public.prevent_late_punch_record_changes();

REVOKE UPDATE, DELETE ON public.registros_ponto FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_edit_punch_record(
  p_record_id uuid,
  p_entrada time,
  p_saida_almoco time,
  p_retorno_almoco time,
  p_saida time,
  p_saida_data date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_record public.registros_ponto%ROWTYPE;
  v_admin_id uuid;
  v_turno text;
  v_has_lunch boolean;
  v_weekday integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_id FROM public.funcionarios
  WHERE auth_id = auth.uid() AND role = 'admin' AND ativo = true;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Administrador ativo não encontrado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_record FROM public.registros_ponto WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de ponto não encontrado.'; END IF;
  IF v_record.created_at IS NULL OR pg_catalog.clock_timestamp() >= v_record.created_at + interval '4 days' THEN
    RAISE EXCEPTION 'Prazo expirado. Este registro está bloqueado para alterações.' USING ERRCODE = '42501';
  END IF;
  IF p_entrada IS NULL THEN RAISE EXCEPTION 'A entrada precisa ter um horário.'; END IF;

  v_turno := public.kairopont_infer_shift(p_entrada);
  v_weekday := extract(isodow FROM v_record.data)::integer;
  v_has_lunch := v_turno = 'turno1' AND v_weekday BETWEEN 1 AND 5;

  IF (p_saida_almoco IS NULL) <> (p_retorno_almoco IS NULL) THEN
    RAISE EXCEPTION 'Preencha os dois horários de almoço ou deixe ambos vazios.';
  END IF;
  IF v_has_lunch AND p_saida_almoco IS NULL THEN
    RAISE EXCEPTION 'Para o 1º turno em dia útil, informe saída e retorno do almoço.';
  END IF;
  IF NOT v_has_lunch AND p_saida_almoco IS NOT NULL THEN
    RAISE EXCEPTION 'O turno classificado não prevê intervalo de almoço neste dia.';
  END IF;
  IF p_saida_almoco IS NOT NULL AND NOT (p_entrada < p_saida_almoco AND p_saida_almoco < p_retorno_almoco) THEN
    RAISE EXCEPTION 'Confira a ordem dos horários de entrada e almoço.';
  END IF;

  IF p_saida IS NULL THEN
    IF p_saida_data IS NOT NULL THEN RAISE EXCEPTION 'Informe a data da saída somente quando houver horário de saída.'; END IF;
  ELSE
    IF v_has_lunch AND p_retorno_almoco IS NULL THEN
      RAISE EXCEPTION 'O retorno do almoço precisa ser informado antes da saída final.';
    END IF;
    IF v_turno = 'turno3' AND p_saida < p_entrada THEN
      IF p_saida_data IS DISTINCT FROM (v_record.data + 1) THEN
        RAISE EXCEPTION 'A saída antes da entrada no relógio deve ser registrada no dia seguinte.';
      END IF;
    ELSIF p_saida_data IS DISTINCT FROM v_record.data OR p_saida <= p_entrada THEN
      RAISE EXCEPTION 'Confira a data e a ordem do horário de saída.';
    END IF;
  END IF;

  UPDATE public.registros_ponto
  SET entrada = p_entrada,
      saida_almoco = p_saida_almoco,
      retorno_almoco = p_retorno_almoco,
      saida = p_saida,
      saida_data = p_saida_data,
      turno_trabalhado = v_turno
  WHERE id = p_record_id;

  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (
    v_admin_id,
    'editar_registro_ponto',
    v_record.funcionario_id,
    jsonb_build_object(
      'registro_id', p_record_id,
      'antes', jsonb_build_object('entrada', v_record.entrada, 'saida_almoco', v_record.saida_almoco, 'retorno_almoco', v_record.retorno_almoco, 'saida', v_record.saida, 'saida_data', v_record.saida_data, 'turno_trabalhado', v_record.turno_trabalhado),
      'depois', jsonb_build_object('entrada', p_entrada, 'saida_almoco', p_saida_almoco, 'retorno_almoco', p_retorno_almoco, 'saida', p_saida, 'saida_data', p_saida_data, 'turno_trabalhado', v_turno)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_edit_punch_record(uuid, time, time, time, time, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_punch_record(uuid, time, time, time, time, date) TO authenticated;
