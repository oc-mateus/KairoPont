import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TICKET_FIELDS } from '../lib/support';

export default function useSupportTickets({ enabled, employeeId, admin = false, status = 'todos' }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => { setPage(0); setRevision((value) => value + 1); }, []);

  useEffect(() => { setPage(0); }, [employeeId, status]);
  useEffect(() => {
    const request = ++generation.current;
    setTickets([]);
    setError('');
    if (!enabled || !employeeId) { setLoading(false); return; }
    setLoading(true);
    let query = admin
      ? supabase.rpc('list_support_tickets', { p_status: status, p_offset: page * 20 })
      : supabase.from('support_tickets').select(TICKET_FIELDS)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(page * 20, page * 20 + 20).eq('funcionario_id', employeeId);
    if (!admin && status !== 'todos') query = query.eq('status', status);
    Promise.resolve(query).then(({ data, error: queryError }) => {
      if (request !== generation.current) return;
      if (queryError) throw queryError;
      setTickets((data || []).slice(0, 20));
      setHasMore((data || []).length > 20);
    }).catch(() => {
      if (request === generation.current) setError('Não foi possível carregar os chamados. Tente atualizar a lista.');
    }).finally(() => {
      if (request === generation.current) setLoading(false);
    });
    return () => { generation.current++; };
  }, [enabled, employeeId, admin, status, page, revision]);

  return { tickets, loading, error, page, hasMore, setPage, refresh };
}
