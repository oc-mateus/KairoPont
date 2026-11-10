const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export async function notifySupportTeam({ client, ticket, actorId, config, fetchImpl = fetch }) {
  if (!config.enabled || !config.apiKey || !emailPattern.test(config.to || '') || !emailPattern.test(config.from || '')) return 'not_configured';
  try {
    if (!ticket?.funcionario_id) return 'pending';
    // Identity comes from the saved ticket's owner, never from request fields.
    const { data: requester, error: requesterError } = await client.from('funcionarios')
      .select('nome,email').eq('id', ticket.funcionario_id).maybeSingle();
    if (requesterError || !requester?.nome?.trim() || !emailPattern.test(requester?.email || '')) return 'pending';
    const requesterName = requester.nome.replace(/[\r\n\u0000]/g, ' ').trim();
    const { data: quota, error: quotaError } = await client.rpc('consume_support_quota', { p_action: 'support-email', p_actor_id: actorId });
    if (quotaError || quota?.allowed !== true) return 'pending';
    const { data: claimed, error: claimError } = await client.rpc('claim_support_email', { p_ticket_id: ticket.id });
    if (claimError || claimed !== true) return 'pending';
    let success = false;
    try {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `support-ticket-${ticket.id}` },
        body: JSON.stringify({
          from: config.from, to: [config.to],
          reply_to: requester.email,
          subject: `KairoPont · Chamado #${ticket.protocol}`,
          // Plain text preserves the submitted message without interpreting HTML.
          text: `Um novo chamado aguarda a equipe no KairoPont.\n\nProtocolo: #${ticket.protocol}\nCategoria: ${ticket.category}\nSolicitante: ${requesterName}\nE-mail: ${requester.email}\n\nMensagem:\n${ticket.description}\n\nUse “Responder” neste e-mail para falar diretamente com o solicitante.\n\nConsulte o chamado no painel de suporte:\nhttps://oc-mateus.github.io/KairoPont/admin/suporte`,
        }),
      });
      success = response.ok;
    } finally {
      const { error } = await client.rpc('finish_support_email', { p_ticket_id: ticket.id, p_success: success });
      if (error) success = false;
    }
    return success ? 'sent' : 'pending';
  } catch {
    // The ticket is durable even if provider delivery fails or times out.
    return 'pending';
  }
}
