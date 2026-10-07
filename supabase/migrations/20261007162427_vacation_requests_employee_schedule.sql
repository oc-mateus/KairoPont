-- Admission, weekly work schedules, admin-only invitations, and vacation requests.

ALTER TABLE public.funcionarios
  ADD COLUMN data_admissao date,
  ADD COLUMN escala_trabalho jsonb;

-- Invitations are short-lived authorizations consumed by the Auth user trigger.
-- No browser role can read or create them; only the Edge Function's service role can.
CREATE TABLE public.funcionario_convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  nome text NOT NULL,
  cpf text NOT NULL,
  cargo text NOT NULL,
  data_admissao date NOT NULL,
  escala_trabalho jsonb NOT NULL,
  convidado_por uuid NOT NULL REFERENCES public.funcionarios(id),
  expira_em timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX funcionario_convites_email_idx ON public.funcionario_convites (lower(email));
ALTER TABLE public.funcionario_convites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.funcionario_convites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.funcionario_convites TO service_role;

-- Public Auth signups are rejected unless an administrator has created an invitation.
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
    auth_id, email, nome, cpf, cargo, role, data_admissao, escala_trabalho
  ) VALUES (
    new.id, new.email, v_invite.nome, v_invite.cpf, v_invite.cargo,
    'employee', v_invite.data_admissao, v_invite.escala_trabalho
  );
  RETURN new;
END;
$$;

CREATE TABLE public.periodos_aquisitivos_ferias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  prazo_concessivo date NOT NULL,
  dias_direito smallint NOT NULL DEFAULT 30 CHECK (dias_direito BETWEEN 1 AND 30),
  dias_abono smallint NOT NULL DEFAULT 0 CHECK (dias_abono BETWEEN 0 AND 10),
  abono_solicitado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funcionario_id, periodo_inicio),
  CHECK (periodo_fim >= periodo_inicio),
  CHECK (prazo_concessivo >= periodo_fim)
);

CREATE TABLE public.solicitacoes_ferias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id uuid NOT NULL REFERENCES public.periodos_aquisitivos_ferias(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'recusada')),
  justificativa_recusa text,
  decidida_por uuid REFERENCES public.funcionarios(id),
  decidida_em timestamptz,
  email_enviado_em timestamptz,
  email_erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio),
  CHECK (status <> 'recusada' OR length(trim(coalesce(justificativa_recusa, ''))) >= 5)
);

CREATE UNIQUE INDEX solicitacoes_ferias_ativas_por_periodo_idx
  ON public.solicitacoes_ferias (periodo_id)
  WHERE status IN ('pendente', 'aprovada');
CREATE INDEX solicitacoes_ferias_funcionario_idx
  ON public.solicitacoes_ferias (funcionario_id, created_at DESC);

CREATE TABLE public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  referencia text NOT NULL UNIQUE,
  lida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notificacoes_funcionario_idx
  ON public.notificacoes (funcionario_id, created_at DESC);

ALTER TABLE public.periodos_aquisitivos_ferias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_ferias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.periodos_aquisitivos_ferias TO authenticated;
GRANT SELECT ON public.solicitacoes_ferias TO authenticated;
GRANT SELECT ON public.notificacoes TO authenticated;
GRANT UPDATE (lida_em) ON public.notificacoes TO authenticated;

CREATE POLICY "Funcionário e admin consultam períodos de férias autorizados"
  ON public.periodos_aquisitivos_ferias FOR SELECT TO authenticated
  USING (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid()))
    OR (SELECT public.is_admin())
  );

CREATE POLICY "Funcionário e admin consultam solicitações autorizadas"
  ON public.solicitacoes_ferias FOR SELECT TO authenticated
  USING (
    funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid()))
    OR (SELECT public.is_admin())
  );

CREATE POLICY "Funcionário consulta e marca suas notificações"
  ON public.notificacoes FOR SELECT TO authenticated
  USING (funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid())));

CREATE POLICY "Funcionário atualiza leitura das próprias notificações"
  ON public.notificacoes FOR UPDATE TO authenticated
  USING (funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid())))
  WITH CHECK (funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.admin_update_employee_employment(
  p_funcionario_id uuid,
  p_data_admissao date,
  p_escala_trabalho jsonb
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
  IF p_data_admissao > current_date OR jsonb_typeof(p_escala_trabalho) <> 'object' THEN
    RAISE EXCEPTION 'Data de admissão ou escala de trabalho inválida.';
  END IF;

  UPDATE public.funcionarios
  SET data_admissao = p_data_admissao, escala_trabalho = p_escala_trabalho
  WHERE id = p_funcionario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_employment(uuid, date, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_current_vacation_periods()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee record;
  v_years integer;
  v_cycle integer;
  v_period_start date;
  v_period_end date;
  v_due date;
  v_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501';
  END IF;

  IF public.is_admin() THEN
    FOR v_employee IN
      SELECT id, data_admissao FROM public.funcionarios
      WHERE ativo = true AND data_admissao IS NOT NULL
    LOOP
      v_employee_id := v_employee.id;
      v_years := extract(year FROM age(current_date, v_employee.data_admissao))::integer;
      FOR v_cycle IN 0..greatest(v_years, 0) LOOP
        v_period_start := (v_employee.data_admissao + make_interval(years => v_cycle))::date;
        v_period_end := (v_period_start + interval '1 year' - interval '1 day')::date;
        v_due := (v_period_start + interval '2 years' - interval '1 day')::date;
        INSERT INTO public.periodos_aquisitivos_ferias (funcionario_id, periodo_inicio, periodo_fim, prazo_concessivo)
        VALUES (v_employee_id, v_period_start, v_period_end, v_due)
        ON CONFLICT (funcionario_id, periodo_inicio) DO NOTHING;
      END LOOP;
    END LOOP;
  ELSE
    SELECT id, data_admissao INTO v_employee
    FROM public.funcionarios WHERE auth_id = auth.uid() AND ativo = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário ativo não encontrado.' USING ERRCODE = '42501'; END IF;
    IF v_employee.data_admissao IS NULL THEN RETURN; END IF;

    v_employee_id := v_employee.id;
    v_years := extract(year FROM age(current_date, v_employee.data_admissao))::integer;
    FOR v_cycle IN 0..greatest(v_years, 0) LOOP
      v_period_start := (v_employee.data_admissao + make_interval(years => v_cycle))::date;
      v_period_end := (v_period_start + interval '1 year' - interval '1 day')::date;
      v_due := (v_period_start + interval '2 years' - interval '1 day')::date;
      INSERT INTO public.periodos_aquisitivos_ferias (funcionario_id, periodo_inicio, periodo_fim, prazo_concessivo)
      VALUES (v_employee_id, v_period_start, v_period_end, v_due)
      ON CONFLICT (funcionario_id, periodo_inicio) DO NOTHING;
    END LOOP;
  END IF;

  INSERT INTO public.notificacoes (funcionario_id, tipo, titulo, mensagem, referencia)
  SELECT p.funcionario_id,
    CASE WHEN p.prazo_concessivo < current_date THEN 'ferias_vencidas' ELSE 'ferias_vencimento_proximo' END,
    CASE WHEN p.prazo_concessivo < current_date THEN 'Prazo de férias vencido' ELSE 'Prazo de férias próximo' END,
    CASE WHEN p.prazo_concessivo < current_date
      THEN 'O prazo concessivo do período iniciado em ' || to_char(p.periodo_inicio, 'DD/MM/YYYY') || ' terminou em ' || to_char(p.prazo_concessivo, 'DD/MM/YYYY') || '. Procure o administrador.'
      ELSE 'O prazo concessivo do período iniciado em ' || to_char(p.periodo_inicio, 'DD/MM/YYYY') || ' termina em ' || to_char(p.prazo_concessivo, 'DD/MM/YYYY') || '.'
    END,
    CASE WHEN p.prazo_concessivo < current_date THEN 'ferias-vencidas:' ELSE 'ferias-prazo:' END || p.id::text
  FROM public.periodos_aquisitivos_ferias p
  WHERE ((public.is_admin()) OR p.funcionario_id = v_employee_id)
    AND p.prazo_concessivo <= current_date + 60
    AND NOT EXISTS (
      SELECT 1 FROM public.solicitacoes_ferias r
      WHERE r.periodo_id = p.id AND r.status = 'aprovada'
    )
  ON CONFLICT (referencia) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_current_vacation_periods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_current_vacation_periods() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_vacation_sale_intention(
  p_periodo_id uuid,
  p_dias_abono smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee public.funcionarios%ROWTYPE;
  v_period public.periodos_aquisitivos_ferias%ROWTYPE;
BEGIN
  SELECT * INTO v_employee FROM public.funcionarios
  WHERE auth_id = auth.uid() AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário ativo não encontrado.' USING ERRCODE = '42501'; END IF;
  IF p_dias_abono < 0 OR p_dias_abono > 10 THEN RAISE EXCEPTION 'O abono deve ser de 0 a 10 dias.'; END IF;

  SELECT * INTO v_period FROM public.periodos_aquisitivos_ferias
  WHERE id = p_periodo_id AND funcionario_id = v_employee.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período aquisitivo não encontrado.'; END IF;
  IF current_date > v_period.periodo_fim - 15 THEN
    RAISE EXCEPTION 'O prazo para registrar o abono deste período terminou.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.solicitacoes_ferias WHERE periodo_id = v_period.id AND status = 'aprovada') THEN
    RAISE EXCEPTION 'Este período já possui férias aprovadas.';
  END IF;

  UPDATE public.periodos_aquisitivos_ferias
  SET dias_abono = p_dias_abono, abono_solicitado_em = now()
  WHERE id = v_period.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_vacation_sale_intention(uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vacation_sale_intention(uuid, smallint) TO authenticated;

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

  INSERT INTO public.solicitacoes_ferias (periodo_id, funcionario_id, data_inicio, data_fim)
  VALUES (v_period.id, v_employee.id, p_data_inicio, p_data_fim)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_vacation_request(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_vacation_request(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_vacation_request(
  p_solicitacao_id uuid,
  p_aprovar boolean,
  p_justificativa text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_request public.solicitacoes_ferias%ROWTYPE;
  v_period public.periodos_aquisitivos_ferias%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Operação restrita a administradores.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_admin_id FROM public.funcionarios WHERE auth_id = auth.uid();
  SELECT * INTO v_request FROM public.solicitacoes_ferias WHERE id = p_solicitacao_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pendente' THEN RAISE EXCEPTION 'Solicitação pendente não encontrada.'; END IF;
  SELECT * INTO v_period FROM public.periodos_aquisitivos_ferias WHERE id = v_request.periodo_id;
  IF NOT p_aprovar AND length(trim(coalesce(p_justificativa, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe a justificativa da recusa (mínimo de 5 caracteres).';
  END IF;

  UPDATE public.solicitacoes_ferias
  SET status = CASE WHEN p_aprovar THEN 'aprovada' ELSE 'recusada' END,
      justificativa_recusa = CASE WHEN p_aprovar THEN NULL ELSE trim(p_justificativa) END,
      decidida_por = v_admin_id, decidida_em = now()
  WHERE id = v_request.id;

  INSERT INTO public.auditoria (admin_id, acao, alvo_id, detalhes)
  VALUES (v_admin_id, 'decidir_solicitacao_ferias', v_request.funcionario_id,
    jsonb_build_object('solicitacao_id', v_request.id, 'aprovada', p_aprovar, 'justificativa', CASE WHEN p_aprovar THEN NULL ELSE trim(p_justificativa) END,
      'periodo_aquisitivo_inicio', v_period.periodo_inicio));
END;
$$;
REVOKE ALL ON FUNCTION public.decide_vacation_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_vacation_request(uuid, boolean, text) TO authenticated;

COMMENT ON COLUMN public.funcionarios.data_admissao IS 'Data de admissão informada por administrador; base para ciclos aquisitivos de férias.';
COMMENT ON COLUMN public.funcionarios.escala_trabalho IS 'Escala semanal planejada em JSON; usada para comparar a folha de ponto.';
COMMENT ON TABLE public.periodos_aquisitivos_ferias IS 'Ciclos de férias calculados a partir da admissão; o abono é registrado dentro do prazo legal.';
