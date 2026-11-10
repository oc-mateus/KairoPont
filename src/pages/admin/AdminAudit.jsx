import { useState, useEffect } from 'react';
import LoadError from '../../components/LoadError';
import { supabase } from '../../lib/supabase';
import { formatDateTime } from '../../lib/utils';
import { Spinner, Badge } from '../../components/ui';

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('auditoria')
        .select('id,created_at,acao,detalhes,admin:admin_id(nome),alvo:alvo_id(nome)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('Erro ao carregar auditoria:', err);
      setLoadError(true);
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

      </div>

      {loading ? (
        <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>
      ) : loadError ? (
        <LoadError message="Não foi possível carregar a auditoria. Confira sua conexão e tente novamente." onRetry={fetchLogs} />
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
