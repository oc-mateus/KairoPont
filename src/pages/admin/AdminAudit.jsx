import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDateTime } from '../../lib/utils';
import { Spinner, Badge } from '../../components/ui';

export default function AdminAudit() {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('auditoria')
        .select('*, admin:admin_id(nome), alvo:alvo_id(nome)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      toast.error('Erro ao carregar auditoria: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Auditoria do Sistema</h2>
        <p className="page-subtitle">Histórico de ações administrativas.</p>
      </div>

      {loading ? (
        <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Administrador</th>
                <th>Ação</th>
                <th>Alvo</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.created_at)}</td>
                  <td style={{ fontWeight: 500 }}>{log.admin?.nome || 'Sistema'}</td>
                  <td>
                    <Badge variant="neutral">{log.acao}</Badge>
                  </td>
                  <td>{log.alvo?.nome || '—'}</td>
                  <td style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>
                    {log.detalhes ? JSON.stringify(log.detalhes) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
