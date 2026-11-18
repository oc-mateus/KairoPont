import { useState, useEffect } from 'react';
import LoadError from '../../components/LoadError';
import { supabase } from '../../lib/supabase';
import { formatDate, formatDateTime } from '../../lib/utils';
import { EmptyState, Spinner } from '../../components/ui';
import './AdminAudit.css';

const actionLabels = {
  atualizar_funcionario: 'Acesso do funcionário atualizado',
  atualizar_cadastro_funcionario: 'Cadastro do funcionário atualizado',
  alterar_documento_funcionario: 'Documento do funcionário alterado',
  decidir_solicitacao_ferias: 'Pedido de férias analisado',
  editar_registro_ponto: 'Registro de ponto editado',
  excluir_registro_ponto: 'Registro de ponto excluído',
  criar_registro_historico: 'Registro histórico de ponto incluído',
  editar_registro_historico: 'Registro histórico de ponto corrigido',
  observacao_edicao_registro_ponto: 'Observação sobre o ajuste de ponto',
  ponto_offline_sincronizado: 'Ponto offline sincronizado',
  responder_suporte: 'Chamado de suporte respondido',
  atualizar_status_suporte: 'Situação do chamado atualizada',
  alterar_acesso_suporte: 'Acesso ao suporte alterado',
  criar_contrato_pj: 'Projeto PJ criado',
  editar_contrato_pj: 'Projeto PJ editado',
  concluir_contrato_pj: 'Projeto PJ concluído',
  reabrir_contrato_pj: 'Projeto PJ reaberto',
};

const fieldLabels = {
  antes: 'Antes', depois: 'Depois', motivo: 'Motivo', justificativa: 'Justificativa',
  observacao: 'Observação', ator_nome: 'Nome do responsável', ator_id: 'ID do responsável',
  registro_id: 'ID do registro', contrato_id: 'ID do projeto', contrato: 'Projeto',
  ticket_id: 'ID do chamado', solicitacao_id: 'ID da solicitação', role: 'Perfil de acesso',
  horario: 'Horário de trabalho', horario_aparelho: 'Horário do aparelho', recebido_em: 'Recebido em',
  saida: 'Saída', saida_data: 'Data da saída', saida_almoco: 'Início do intervalo',
  retorno_almoco: 'Fim do intervalo', periodo_aquisitivo_inicio: 'Início do período aquisitivo',
  tipo_contrato: 'Tipo de contrato', escala_trabalho: 'Escala de trabalho',
  data_admissao: 'Data de admissão', created_at: 'Criado em',
};

function readableLabel(labels, key) {
  if (Object.hasOwn(labels, key)) return labels[key];
  const words = key.replaceAll('_', ' ');
  return words.charAt(0).toLocaleUpperCase('pt-BR') + words.slice(1);
}

function AuditValue({ value }) {
  if (value === null || value === '') return 'Não informado';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) {
    return value.length ? (
      <ul className="audit-value-list">
        {value.map((item, index) => <li key={index}><AuditValue value={item} /></li>)}
      </ul>
    ) : 'Nenhum item';
  }
  if (typeof value === 'object') return <AuditFields data={value} />;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))) return formatDate(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) return formatDateTime(value);
  return String(value);
}

function AuditFields({ data, topLevel = false }) {
  const { motivo, justificativa, observacao, antes, depois, ...otherFields } = data;
  const fields = Object.entries({ motivo, justificativa, observacao, antes, depois, ...otherFields })
    .filter(([, value]) => value !== undefined);
  if (!fields.length) return 'Nenhum detalhe registrado';
  return (
    <dl className={topLevel ? 'audit-fields audit-fields-main' : 'audit-fields'}>
      {fields.map(([key, value]) => (
        <div key={key} className={['motivo', 'justificativa', 'observacao'].includes(key) ? 'audit-field-wide' : undefined}>
          <dt>{readableLabel(fieldLabels, key)}</dt>
          <dd><AuditValue value={value} /></dd>
        </div>
      ))}
    </dl>
  );
}

function AuditRecord({ log }) {
  const action = readableLabel(actionLabels, log.acao || 'Ação não informada');
  return (
    <li className="audit-record">
      <div className="audit-record-heading">
        <h3>{action}</h3>
        <time dateTime={log.created_at}>{formatDateTime(log.created_at)}</time>
      </div>
      <dl className="audit-record-people">
        <div>
          <dt>Responsável</dt>
          <dd>{log.admin?.nome || log.detalhes?.ator_nome || 'Sistema'}</dd>
        </div>
        <div>
          <dt>Alvo</dt>
          <dd>{log.alvo?.nome || log.detalhes?.contrato || 'Não informado'}</dd>
        </div>
      </dl>
      {log.detalhes != null && (
        <details className="audit-record-details">
          <summary>Detalhes da ação</summary>
          <div className="audit-details-content">
            {typeof log.detalhes === 'object' && !Array.isArray(log.detalhes)
              ? <AuditFields data={log.detalhes} topLevel />
              : <AuditValue value={log.detalhes} />}
          </div>
        </details>
      )}
    </li>
  );
}

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
      <header className="page-header">
        <div className="page-header-left">
          <h2 className="page-title">Auditoria do sistema</h2>
          <p className="page-subtitle">As 100 ações mais recentes, da mais nova à mais antiga.</p>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>
      ) : loadError ? (
        <LoadError message="Não foi possível carregar a auditoria. Confira sua conexão e tente novamente." onRetry={fetchLogs} />
      ) : logs.length ? (
        <ul className="audit-records" aria-label="Ações registradas" role="list">
          {logs.map(log => <AuditRecord key={log.id} log={log} />)}
        </ul>
      ) : (
        <EmptyState title="Nenhuma ação registrada" />
      )}
    </div>
  );
}
