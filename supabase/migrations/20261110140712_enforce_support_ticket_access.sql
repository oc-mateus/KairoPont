DROP POLICY "Active employee reads own tickets; admin reads queue" ON public.support_tickets;
CREATE POLICY "Active employee reads own tickets; support reads queue"
  ON public.support_tickets FOR SELECT TO authenticated
  USING(funcionario_id IN (SELECT id FROM public.funcionarios WHERE auth_id=(SELECT auth.uid()) AND ativo=true)
    OR (SELECT public.is_support()));

-- Replies now happen in the operator's email app. Preserve legacy data but
-- remove client access to the old portal-reply function.
REVOKE ALL ON FUNCTION public.admin_respond_support_ticket(uuid,text,text) FROM PUBLIC,anon,authenticated;
ALTER TABLE public.support_tickets DROP CONSTRAINT support_tickets_check;

CREATE FUNCTION public.support_update_ticket_status(p_ticket_id uuid,p_status text)
RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_support uuid; v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF NOT public.is_support() THEN RAISE EXCEPTION 'Acesso ao suporte necessário.' USING ERRCODE='42501'; END IF;
  SELECT id INTO v_support FROM public.funcionarios WHERE auth_id=auth.uid() AND ativo=true AND suporte=true;
  IF p_status IS NULL OR p_status NOT IN ('aberto','em_atendimento','respondido','encerrado') THEN
    RAISE EXCEPTION 'Informe um status de atendimento válido.' USING ERRCODE='22023';
  END IF;
  UPDATE public.support_tickets SET status=p_status,updated_at=now(),
    responded_by=CASE WHEN p_status='respondido' THEN v_support ELSE responded_by END,
    responded_at=CASE WHEN p_status='respondido' THEN now() ELSE responded_at END
  WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.auditoria(admin_id,acao,alvo_id,detalhes)
  VALUES(v_support,'atualizar_status_suporte',v_ticket.funcionario_id,jsonb_build_object('ticket_id',v_ticket.id,'status',p_status));
  RETURN v_ticket;
END;
$$;
REVOKE ALL ON FUNCTION public.support_update_ticket_status(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_update_ticket_status(uuid,text) TO authenticated;

-- Return only the contact fields needed for a ticket. Support access must not
-- grant access to colleagues' CPF, schedule, documents or other profile fields.
CREATE FUNCTION public.list_support_tickets(p_status text,p_offset integer)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_support() THEN RAISE EXCEPTION 'Acesso ao suporte necessário.' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('todos','aberto','em_atendimento','respondido','encerrado')
    OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN
    RAISE EXCEPTION 'Filtro de atendimento inválido.' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT jsonb_build_object(
    'id',t.id,'protocol',t.protocol,'funcionario_id',t.funcionario_id,
    'category',t.category,'subject',t.subject,'description',t.description,
    'status',t.status,'created_at',t.created_at,'updated_at',t.updated_at,
    'employee',jsonb_build_object('nome',f.nome,'email',f.email))
  FROM public.support_tickets t JOIN public.funcionarios f ON f.id=t.funcionario_id
  WHERE p_status='todos' OR t.status=p_status
  ORDER BY t.created_at DESC,t.id DESC LIMIT 21 OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.list_support_tickets(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_support_tickets(text,integer) TO authenticated;
