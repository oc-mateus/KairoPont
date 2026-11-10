-- LOCAL ONLY: prepare and test; deployment requires a later user request.
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id),
  request_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('acesso','ponto','exportacao','arquivos','outro')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 3000),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_atendimento','respondido','encerrado')),
  response text CHECK (char_length(response) <= 4000),
  responded_by uuid REFERENCES public.funcionarios(id),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funcionario_id, request_id),
  CHECK (status <> 'respondido' OR char_length(trim(coalesce(response,''))) >= 5)
);
CREATE INDEX support_tickets_employee_created_idx ON public.support_tickets(funcionario_id,created_at DESC);
CREATE INDEX support_tickets_status_created_idx ON public.support_tickets(status,created_at DESC);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.support_tickets_protocol_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
CREATE POLICY "Active employee reads own tickets; admin reads queue"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id=(SELECT auth.uid()) AND ativo=true)
    OR (SELECT public.is_admin()));

-- Delivery metadata is private; users cannot edit or inspect provider errors.
CREATE TABLE private.support_email_delivery (
  ticket_id uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed')),
  attempted_at timestamptz,
  first_attempt_at timestamptz,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
);
ALTER TABLE private.support_email_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.support_email_delivery FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.take_support_quota(p_action text,p_subject text,p_seconds integer,p_maximum integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_row private.edge_rate_limits%ROWTYPE;
BEGIN
  INSERT INTO private.edge_rate_limits AS counters(action,subject,window_seconds,window_started_at,requests)
  VALUES(p_action,p_subject,p_seconds,v_now,1)
  ON CONFLICT(action,subject,window_seconds) DO UPDATE SET
    window_started_at=CASE WHEN counters.window_started_at+make_interval(secs=>p_seconds)<=v_now THEN v_now ELSE counters.window_started_at END,
    requests=CASE WHEN counters.window_started_at+make_interval(secs=>p_seconds)<=v_now THEN 1 ELSE least(counters.requests+1,p_maximum+1) END
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('allowed',v_row.requests<=p_maximum,'retry_after',
    CASE WHEN v_row.requests<=p_maximum THEN 0 ELSE greatest(1,ceil(extract(epoch FROM(v_row.window_started_at+make_interval(secs=>p_seconds)-v_now)))::integer) END);
END;
$$;
REVOKE ALL ON FUNCTION private.take_support_quota(text,text,integer,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.consume_support_quota(p_action text,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb; v_rule record;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('support-question','support-email') THEN
    RAISE EXCEPTION 'Ação inválida.' USING ERRCODE='22023';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.funcionarios WHERE auth_id=p_actor_id AND ativo=true) THEN
    RAISE EXCEPTION 'Conta ativa necessária.' USING ERRCODE='42501';
  END IF;
  FOR v_rule IN SELECT * FROM (VALUES
    (1,p_actor_id::text,60,CASE WHEN p_action='support-question' THEN 5 ELSE 3 END),
    (2,p_actor_id::text,86400,CASE WHEN p_action='support-question' THEN 30 ELSE 10 END),
    (3,'project',86400,CASE WHEN p_action='support-question' THEN 200 ELSE 100 END)
  ) AS rules(position,subject,seconds,maximum) ORDER BY position LOOP
    v_result:=private.take_support_quota(p_action,v_rule.subject,v_rule.seconds,v_rule.maximum);
    IF NOT (v_result->>'allowed')::boolean THEN RETURN v_result; END IF;
  END LOOP;
  RETURN jsonb_build_object('allowed',true,'retry_after',0);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_support_quota(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_support_quota(text,uuid) TO service_role;

CREATE FUNCTION public.create_support_ticket(p_request_id uuid,p_category text,p_subject text,p_description text)
RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_employee uuid; v_ticket public.support_tickets%ROWTYPE; v_result jsonb; v_rule record;
BEGIN
  SELECT id INTO v_employee FROM public.funcionarios WHERE auth_id=auth.uid() AND ativo=true;
  IF v_employee IS NULL THEN RAISE EXCEPTION 'Conta ativa necessária.' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_category IS NULL OR p_category NOT IN ('acesso','ponto','exportacao','arquivos','outro')
    OR char_length(trim(coalesce(p_subject,''))) NOT BETWEEN 3 AND 120
    OR char_length(trim(coalesce(p_description,''))) NOT BETWEEN 10 AND 3000 THEN
    RAISE EXCEPTION 'Confira o assunto e a descrição do chamado.' USING ERRCODE='22023';
  END IF;
  -- Serialize one employee's submissions so parallel retries cannot create duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_employee::text,871002));
  SELECT * INTO v_ticket FROM public.support_tickets WHERE funcionario_id=v_employee AND request_id=p_request_id;
  IF FOUND THEN
    IF v_ticket.category<>p_category OR v_ticket.subject<>trim(p_subject) OR v_ticket.description<>trim(p_description) THEN
      RAISE EXCEPTION 'Esta solicitação já foi usada com outros dados. Inicie um novo chamado.' USING ERRCODE='22023';
    END IF;
    RETURN v_ticket;
  END IF;
  FOR v_rule IN SELECT * FROM (VALUES(v_employee::text,3600,3),(v_employee::text,86400,5),('project',86400,100))
    AS rules(subject,seconds,maximum) LOOP
    v_result:=private.take_support_quota('support-ticket',v_rule.subject,v_rule.seconds,v_rule.maximum);
    IF NOT (v_result->>'allowed')::boolean THEN
      RAISE EXCEPTION 'Limite de chamados atingido. Tente novamente mais tarde.' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  INSERT INTO public.support_tickets(funcionario_id,request_id,category,subject,description)
  VALUES(v_employee,p_request_id,p_category,trim(p_subject),trim(p_description)) RETURNING * INTO v_ticket;
  RETURN v_ticket;
END;
$$;
REVOKE ALL ON FUNCTION public.create_support_ticket(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(uuid,text,text,text) TO authenticated;

CREATE FUNCTION public.admin_respond_support_ticket(p_ticket_id uuid,p_response text,p_status text)
RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admin uuid; v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrador ativo necessário.' USING ERRCODE='42501'; END IF;
  SELECT id INTO v_admin FROM public.funcionarios WHERE auth_id=auth.uid() AND ativo=true AND role='admin';
  IF p_status IS NULL OR p_status NOT IN ('em_atendimento','respondido','encerrado')
    OR char_length(coalesce(p_response,''))>4000
    OR (p_status='respondido' AND char_length(trim(coalesce(p_response,'')))<5) THEN
    RAISE EXCEPTION 'Informe uma resposta válida e o status do atendimento.' USING ERRCODE='22023';
  END IF;
  UPDATE public.support_tickets SET status=p_status,response=nullif(trim(p_response),''),responded_by=v_admin,
    responded_at=now(),updated_at=now() WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.auditoria(admin_id,acao,alvo_id,detalhes)
  VALUES(v_admin,'responder_suporte',v_ticket.funcionario_id,jsonb_build_object('ticket_id',v_ticket.id,'status',p_status));
  RETURN v_ticket;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_respond_support_ticket(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_respond_support_ticket(uuid,text,text) TO authenticated;

CREATE FUNCTION public.claim_support_email(p_ticket_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO private.support_email_delivery(ticket_id) VALUES(p_ticket_id) ON CONFLICT DO NOTHING;
  UPDATE private.support_email_delivery SET state='sending',attempted_at=now(),first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1
  WHERE ticket_id=p_ticket_id AND state<>'sent' AND attempts<5
    AND (state<>'sending' OR attempted_at<now()-interval '5 minutes')
    -- Provider idempotency keys last 24h. Older uncertain attempts need manual review.
    AND (attempts=0 OR first_attempt_at>now()-interval '23 hours');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count=1;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_support_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_support_email(uuid) TO service_role;

CREATE FUNCTION public.finish_support_email(p_ticket_id uuid,p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE private.support_email_delivery SET state=CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
    sent_at=CASE WHEN p_success THEN now() ELSE NULL END WHERE ticket_id=p_ticket_id AND state='sending';
END;
$$;
REVOKE ALL ON FUNCTION public.finish_support_email(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_support_email(uuid,boolean) TO service_role;
