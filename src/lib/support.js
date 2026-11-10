import { supabase } from './supabase';
import { DEFAULT_SUPPORT_EMAIL } from '../../shared/support.mjs';

export const supportEnabled = import.meta.env.VITE_SUPPORT_ENABLED === 'true';
const configuredEmail = (import.meta.env.VITE_SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim();
export const supportEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(configuredEmail) ? configuredEmail : '';

export async function supportRequest(body) {
  if (!supportEnabled) throw new Error('A abertura de chamados ainda está em preparação. Consulte a base de ajuda.');
  const { data, error } = await supabase.functions.invoke('support-assistant', { body });
  if (error) {
    const details = await error.context?.json?.().catch(() => null);
    throw new Error(details?.error || 'Não foi possível concluir a solicitação. Confira a conexão e tente novamente.');
  }
  return data;
}

export const TICKET_FIELDS = 'id,protocol,category,subject,description,status,response,created_at,updated_at,funcionario_id';
