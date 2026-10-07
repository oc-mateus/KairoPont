ALTER TABLE public.solicitacoes_ferias
  ADD COLUMN data_retorno date;

-- Old requests stored the final day of vacation in data_fim. Preserve their
-- original meaning by deriving the following return-to-work date.
UPDATE public.solicitacoes_ferias
SET data_retorno = data_fim + 1
WHERE data_retorno IS NULL;

ALTER TABLE public.solicitacoes_ferias
  ALTER COLUMN data_retorno SET NOT NULL,
  ADD CONSTRAINT solicitacoes_ferias_return_after_start
    CHECK (data_retorno > data_inicio),
  ADD CONSTRAINT solicitacoes_ferias_return_after_last_vacation_day
    CHECK (data_retorno = data_fim + 1);

-- Keep the existing endpoint compatible with cached clients that still send
-- the final vacation day as p_data_fim.
CREATE OR REPLACE FUNCTION public.submit_vacation_request(
  p_periodo_id uuid,
  p_data_inicio date,
  p_data_fim date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee public.funcionarios%ROWTYPE;
  v_period public.periodos_aquisitivos_ferias%ROWTYPE;
  v_request_id uuid;
  v_days integer;
BEGIN
  SELECT * INTO v_employee FROM public.funcionarios
  WHERE auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário ativo não encontrado.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_period FROM public.periodos_aquisitivos_ferias
  WHERE id = p_periodo_id AND funcionario_id = v_employee.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período aquisitivo não encontrado.'; END IF;
  IF current_date <= v_period.periodo_fim THEN RAISE EXCEPTION 'As datas de gozo só podem ser solicitadas após completar um ano.'; END IF;
  IF current_date > v_period.prazo_concessivo OR p_data_fim > v_period.prazo_concessivo THEN
    RAISE EXCEPTION 'As férias precisam ocorrer dentro do prazo concessivo.';
  END IF;
  IF p_data_inicio < current_date + 30 THEN RAISE EXCEPTION 'Escolha uma data de início com pelo menos 30 dias de antecedência.'; END IF;
  IF p_data_fim < p_data_inicio THEN RAISE EXCEPTION 'O período informado é inválido.'; END IF;
  v_days := p_data_fim - p_data_inicio + 1;
  IF v_days + v_period.dias_abono <> v_period.dias_direito THEN
    RAISE EXCEPTION 'O período deve totalizar % dias, considerando o abono registrado.', v_period.dias_direito;
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'aprovada') THEN
    RAISE EXCEPTION 'Este período já foi aprovado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'pendente') THEN
    RAISE EXCEPTION 'Já existe uma solicitação pendente para este período.';
  END IF;

  INSERT INTO public.solicitacoes_ferias (periodo_id, funcionario_id, data_inicio, data_fim, data_retorno)
  VALUES (v_period.id, v_employee.id, p_data_inicio, p_data_fim, p_data_fim + 1)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_vacation_request(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_vacation_request(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_vacation_request_with_return(
  p_periodo_id uuid,
  p_data_saida date,
  p_data_retorno date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee public.funcionarios%ROWTYPE;
  v_period public.periodos_aquisitivos_ferias%ROWTYPE;
  v_request_id uuid;
  v_last_vacation_day date;
  v_days integer;
BEGIN
  SELECT * INTO v_employee FROM public.funcionarios
  WHERE auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário ativo não encontrado.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_period FROM public.periodos_aquisitivos_ferias
  WHERE id = p_periodo_id AND funcionario_id = v_employee.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período aquisitivo não encontrado.'; END IF;
  IF current_date <= v_period.periodo_fim THEN RAISE EXCEPTION 'As datas de gozo só podem ser solicitadas após completar um ano.'; END IF;
  IF p_data_retorno <= p_data_saida THEN RAISE EXCEPTION 'A data de retorno precisa ser posterior à data de saída.'; END IF;
  v_last_vacation_day := p_data_retorno - 1;
  IF current_date > v_period.prazo_concessivo OR v_last_vacation_day > v_period.prazo_concessivo THEN
    RAISE EXCEPTION 'As férias precisam ocorrer dentro do prazo concessivo.';
  END IF;
  IF p_data_saida < current_date + 30 THEN RAISE EXCEPTION 'Escolha uma data de saída com pelo menos 30 dias de antecedência.'; END IF;
  v_days := p_data_retorno - p_data_saida;
  IF v_days + v_period.dias_abono <> v_period.dias_direito THEN
    RAISE EXCEPTION 'O período deve totalizar % dias, considerando o abono registrado.', v_period.dias_direito;
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'aprovada') THEN
    RAISE EXCEPTION 'Este período já foi aprovado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'pendente') THEN
    RAISE EXCEPTION 'Já existe uma solicitação pendente para este período.';
  END IF;

  INSERT INTO public.solicitacoes_ferias (periodo_id, funcionario_id, data_inicio, data_fim, data_retorno)
  VALUES (v_period.id, v_employee.id, p_data_saida, v_last_vacation_day, p_data_retorno)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_vacation_request_with_return(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_vacation_request_with_return(uuid, date, date) TO authenticated;
