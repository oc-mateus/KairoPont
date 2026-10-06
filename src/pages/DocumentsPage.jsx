import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/utils';
import { Spinner, EmptyState, Badge, Modal } from '../components/ui';

const DOC_TYPES = [
  { value: 'atestado', label: 'Atestado Médico' },
  { value: 'declaracao_horas', label: 'Declaração de Horas' },
];

export default function DocumentsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Upload form
  const [docType, setDocType] = useState('atestado');
  const [docFile, setDocFile] = useState(null);
  const [docPeriodStart, setDocPeriodStart] = useState('');
  const [docPeriodEnd, setDocPeriodEnd] = useState('');

  const fetchDocuments = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('documentos')
        .select('*')
        .eq('funcionario_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      toast.error('Erro ao carregar documentos: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!docFile) {
      toast.warning('Selecione um arquivo.');
      return;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(docFile.type)) {
      toast.error('Formato não aceito. Use PDF, JPEG, PNG ou WebP.');
      return;
    }

    if (docFile.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 10MB.');
      return;
    }

    setUploading(true);
    try {
      // Upload do arquivo ao bucket privado
      const fileExt = docFile.name.split('.').pop();
      const fileName = `${profile.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, docFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Salva metadados no banco
      const { error: dbError } = await supabase
        .from('documentos')
        .insert({
          funcionario_id: profile.id,
          tipo: docType,
          nome_arquivo: docFile.name,
          caminho_storage: fileName,
          periodo_inicio: docPeriodStart || null,
          periodo_fim: docPeriodEnd || null,
        });

      if (dbError) throw dbError;

      toast.success('Documento enviado com sucesso!');
      setShowUpload(false);
      setDocFile(null);
      setDocPeriodStart('');
      setDocPeriodEnd('');
      fetchDocuments();
    } catch (err) {
      toast.error('Erro ao enviar documento: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc) => {
    try {
      const { data, error } = await supabase.storage
        .from('documentos')
        .createSignedUrl(doc.caminho_storage, 60); // URL válida por 60 segundos

      if (error) throw error;

      window.open(data.signedUrl, '_blank');
    } catch (err) {
      toast.error('Erro ao acessar documento: ' + err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2 className="page-title">Documentos</h2>
          <p className="page-subtitle">Envie atestados médicos e declarações de horas</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
            📎 Enviar Documento
          </button>
        </div>
      </div>

      {/* Upload Modal */}
      <Modal isOpen={showUpload} onClose={() => setShowUpload(false)} title="Enviar Documento">
        <form onSubmit={handleUpload}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Tipo de documento *</label>
              <select
                className="form-input"
                value={docType}
                onChange={e => setDocType(e.target.value)}
              >
                {DOC_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Arquivo (PDF ou imagem) *</label>
              <div className="file-upload">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={e => setDocFile(e.target.files[0])}
                />
                <div className="upload-icon">📁</div>
                <div className="upload-text">
                  {docFile ? docFile.name : 'Clique ou arraste para enviar'}
                </div>
                <div className="upload-hint">PDF, JPEG, PNG ou WebP — máx. 10MB</div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Período início (opcional)</label>
                <input
                  type="date"
                  className="form-input"
                  value={docPeriodStart}
                  onChange={e => setDocPeriodStart(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Período fim (opcional)</label>
                <input
                  type="date"
                  className="form-input"
                  value={docPeriodEnd}
                  onChange={e => setDocPeriodEnd(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setShowUpload(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={uploading}>
              {uploading ? <Spinner /> : 'Enviar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Documents List */}
      {loading ? (
        <div className="flex flex-center" style={{ padding: 'var(--space-12)' }}>
          <Spinner size="lg" />
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          icon="📄"
          title="Nenhum documento"
          text="Você ainda não enviou nenhum documento. Clique em 'Enviar Documento' para começar."
        />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Arquivo</th>
                  <th>Data de envio</th>
                  <th>Período</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id}>
                    <td>
                      <Badge variant={doc.tipo === 'atestado' ? 'warning' : 'info'}>
                        {DOC_TYPES.find(t => t.value === doc.tipo)?.label || doc.tipo}
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
                        📥 Baixar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="table-cards">
            {documents.map(doc => (
              <div key={doc.id} className="table-card-item">
                <div className="table-card-row">
                  <span className="table-card-label">Tipo</span>
                  <Badge variant={doc.tipo === 'atestado' ? 'warning' : 'info'}>
                    {DOC_TYPES.find(t => t.value === doc.tipo)?.label || doc.tipo}
                  </Badge>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Arquivo</span>
                  <span className="table-card-value">{doc.nome_arquivo}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-label">Enviado em</span>
                  <span className="table-card-value">{formatDateTime(doc.created_at)}</span>
                </div>
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <button className="btn btn-ghost btn-sm btn-block" onClick={() => handleDownload(doc)}>
                    📥 Baixar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
