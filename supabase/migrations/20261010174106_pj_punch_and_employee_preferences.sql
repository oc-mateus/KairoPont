-- Classifica o vínculo para separar o fluxo de ponto PJ do fluxo CLT.
ALTER TABLE public.funcionarios
  ADD COLUMN tipo_contrato text NOT NULL DEFAULT 'clt'
  CHECK (tipo_contrato IN ('clt', 'pj'));

ALTER TABLE public.funcionario_convites
  ADD COLUMN tipo_contrato text NOT NULL DEFAULT 'clt'
  CHECK (tipo_contrato IN ('clt', 'pj'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.funcionario_convites%ROWTYPE;
BEGIN
  DELETE FROM public.funcionario_convites
  WHERE lower(email) = lower(new.email)
    AND expira_em > now()
  RETURNING * INTO v_invite;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O cadastro só pode ser feito por convite de um administrador.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.funcionarios (
    auth_id, email, nome, cpf, cargo, role, data_admissao, escala_trabalho, tipo_contrato
  ) VALUES (
    new.id, new.email, v_invite.nome, v_invite.cpf, v_invite.cargo,
    'employee', v_invite.data_admissao, v_invite.escala_trabalho, v_invite.tipo_contrato
  );
  RETURN new;
END;
$$;

-- Preserva as validações existentes da escala e acrescenta a escolha do vínculo.
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
  IF p_tipo_contrato NOT IN ('clt', 'pj') THEN
    RAISE EXCEPTION 'Tipo de vínculo inválido.';
  END IF;
  PERFORM public.admin_update_employee_employment(p_funcionario_id, p_data_admissao, p_escala_trabalho);
  UPDATE public.funcionarios
  SET tipo_contrato = p_tipo_contrato
  WHERE id = p_funcionario_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb, text) TO authenticated;

-- Para PJ, registra somente entrada e saída; o fluxo de intervalos CLT permanece igual.
CREATE OR REPLACE FUNCTION public.registrar_ponto(p_funcionario_id uuid, p_tipo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_data date := (timezone('America/Sao_Paulo', now()))::date;
  v_hora time := (timezone('America/Sao_Paulo', now()))::time;
  v_record public.registros_ponto%ROWTYPE;
  v_shift text;
  v_tipo_contrato text;
  v_shift_distance integer;
  v_entry_minute integer := extract(hour FROM (timezone('America/Sao_Paulo', now())))::integer * 60
    + extract(minute FROM (timezone('America/Sao_Paulo', now())))::integer;
  v_minute integer;
  v_tem_intervalo boolean;
BEGIN
  SELECT tipo_contrato INTO v_tipo_contrato
  FROM public.funcionarios
  WHERE id = p_funcionario_id AND auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário inválido ou inativo.' USING ERRCODE = '42501'; END IF;

  IF p_tipo IS NULL THEN RAISE EXCEPTION 'Tipo de registro inválido.'; END IF;
  IF (v_tipo_contrato = 'pj' AND p_tipo NOT IN ('entrada', 'saida'))
    OR (v_tipo_contrato = 'clt' AND p_tipo NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida')) THEN
    RAISE EXCEPTION 'Tipo de registro inválido para este vínculo.';
  END IF;

  IF p_tipo = 'entrada' THEN
    IF EXISTS (
      SELECT 1 FROM public.registros_ponto
      WHERE funcionario_id = p_funcionario_id AND entrada IS NOT NULL AND saida IS NULL
        AND data >= v_data - 1 AND data <= v_data
    ) OR EXISTS (
      SELECT 1 FROM public.registros_ponto
      WHERE funcionario_id = p_funcionario_id AND data = v_data AND entrada IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Já existe uma jornada em andamento ou uma entrada registrada.';
    END IF;

    v_shift_distance := LEAST(ABS(v_entry_minute - 480), 1440 - ABS(v_entry_minute - 480));
    v_shift := 'turno1';
    v_minute := LEAST(ABS(v_entry_minute - 840), 1440 - ABS(v_entry_minute - 840));
    IF v_minute < v_shift_distance THEN v_shift := 'turno2'; v_shift_distance := v_minute; END IF;
    v_minute := LEAST(ABS(v_entry_minute - 1365), 1440 - ABS(v_entry_minute - 1365));
    IF v_minute < v_shift_distance THEN v_shift := 'turno3'; END IF;

    INSERT INTO public.registros_ponto (funcionario_id, data, entrada, turno_trabalhado)
    VALUES (p_funcionario_id, v_data, v_hora, CASE WHEN v_tipo_contrato = 'pj' THEN NULL ELSE v_shift END);
    RETURN;
  END IF;

  SELECT * INTO v_record FROM public.registros_ponto
  WHERE funcionario_id = p_funcionario_id AND data = v_data AND entrada IS NOT NULL AND saida IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_record FROM public.registros_ponto
    WHERE funcionario_id = p_funcionario_id AND data = v_data - 1 AND entrada IS NOT NULL AND saida IS NULL
      AND (v_tipo_contrato = 'pj' OR turno_trabalhado = 'turno3')
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há jornada aberta para registrar este ponto.'; END IF;

  v_tem_intervalo := coalesce(v_record.turno_trabalhado IN ('turno1', 'turno2') AND extract(isodow FROM v_record.data) BETWEEN 1 AND 5, false);
  CASE p_tipo
    WHEN 'saida_almoco' THEN
      IF v_tipo_contrato <> 'clt' OR NOT v_tem_intervalo THEN RAISE EXCEPTION 'Esta jornada não possui intervalo de almoço configurado.'; END IF;
      IF v_record.saida_almoco IS NOT NULL THEN RAISE EXCEPTION 'Saída para almoço já registrada.'; END IF;
      UPDATE public.registros_ponto SET saida_almoco = v_hora WHERE id = v_record.id;
    WHEN 'retorno_almoco' THEN
      IF v_tipo_contrato <> 'clt' OR NOT v_tem_intervalo OR v_record.saida_almoco IS NULL OR v_record.retorno_almoco IS NOT NULL THEN RAISE EXCEPTION 'Sequência de ponto inválida.'; END IF;
      UPDATE public.registros_ponto SET retorno_almoco = v_hora WHERE id = v_record.id;
    WHEN 'saida' THEN
      IF v_tipo_contrato = 'clt' AND v_tem_intervalo AND v_record.retorno_almoco IS NULL THEN RAISE EXCEPTION 'Registre o retorno do almoço primeiro.'; END IF;
      IF v_record.saida IS NOT NULL THEN RAISE EXCEPTION 'Saída já registrada.'; END IF;
      UPDATE public.registros_ponto SET saida = v_hora, saida_data = v_data WHERE id = v_record.id;
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_ponto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto(uuid, text) TO authenticated;
