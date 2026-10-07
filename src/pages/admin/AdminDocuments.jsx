import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDateTime } from '../../lib/utils';
import { Spinner, Badge } from '../../components/ui';

export default function AdminDocuments() {
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('documentos')
        .select('*, funcionarios(nome)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      toast.error('Erro ao carregar documentos: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleDownload = async (doc) => {
    try {
      const { data, error } = await supabase.storage
        .from('documentos')
        .createSignedUrl(doc.caminho_storage, 60);

      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (err) {
      toast.error('Erro ao acessar documento: ' + err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Documentos Recebidos</h2>
        <p className="page-subtitle">Atestados e declarações enviados pelos funcionários.</p>
      </div>

      {loading ? (
        <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>Tipo</th>
                <th>Arquivo</th>
                <th>Data de Envio</th>
                <th>Período Indicado</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id}>
                  <td style={{ fontWeight: 500 }}>{doc.funcionarios?.nome}</td>
                  <td>
                    <Badge variant={doc.tipo === 'atestado' ? 'warning' : 'info'}>
                      {doc.tipo}
                    </Badge>
                  </td>
                  <td>{doc.nome_arquivo}</td>
                  <td>{formatDateTime(doc.created_at)}</td>
                  <td>
                    {doc.periodo_inicio
                      ? `${doc.periodo_inicio} a ${doc.periodo_fim || doc.periodo_inicio}`
                      : '—'
                    }
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDownload(doc)}
                    >
                      Baixar
                    </button>
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
