import { useEffect, useId, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { fetchAllRows, supabase } from '../lib/supabase';
import { formatDate, formatDateTime, getTodayInSP } from '../lib/utils';
import LoadError from './LoadError';
import { Badge, ConfirmDialog, Modal, Spinner } from './ui';

const fields = 'id,nome,referencia,descricao,prazo,concluido_em,concluido_por,versao';

function listContracts(employeeId, admin) {
  return fetchAllRows(() => {
    const contracts = supabase.from('contratos_pj').select(admin
      ? `${fields},participantes:contratos_pj_participantes(funcionario_id,funcionario:funcionarios(nome))`
      : `${fields},participantes:contratos_pj_participantes!inner(funcionario_id)`)
      .order('created_at', { ascending: false }).order('id');
    return admin ? contracts : contracts.eq('participantes.funcionario_id', employeeId);
  });
}

function ContractEditor({ contract, employees, onSave, onClose, saving }) {
  const [form, setForm] = useState({
    nome: contract.nome ?? '',
    referencia: contract.referencia ?? '',
    descricao: contract.descricao ?? '',
    prazo: contract.prazo ?? '',
    participantes: contract.participantes?.map((person) => person.funcionario_id) ?? [],
  });
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const assignedUnavailable = (contract.participantes ?? [])
    .filter((person) => !employees.some((employee) => employee.id === person.funcionario_id));
  const choices = [
    ...employees,
    ...assignedUnavailable.map((person) => ({
      id: person.funcionario_id,
      nome: `${person.funcionario?.nome ?? 'Funcionário'} (cadastro indisponível)`,
    })),
  ];

  return (
    <Modal isOpen onClose={onClose} title={contract.id ? 'Editar contrato PJ' : 'Novo contrato PJ'} size="lg">
      <form onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
        <div className="modal-body pj-contract-form">
          <label className="form-group">Nome do projeto
            <input className="form-input" required minLength={3} maxLength={120} value={form.nome} onChange={(event) => setField('nome', event.target.value)} disabled={saving} />
          </label>
          <div className="pj-contract-form-row">
            <label className="form-group">Referência do contrato
              <input className="form-input" maxLength={80} value={form.referencia} onChange={(event) => setField('referencia', event.target.value)} disabled={saving} />
            </label>
            <label className="form-group">Prazo previsto
              <input className="form-input" type="date" value={form.prazo} onChange={(event) => setField('prazo', event.target.value)} disabled={saving} />
            </label>
          </div>
          <label className="form-group">Descrição
            <textarea className="form-input" rows={3} maxLength={600} value={form.descricao} onChange={(event) => setField('descricao', event.target.value)} disabled={saving} />
          </label>
          <fieldset className="pj-contract-team" disabled={saving}>
            <legend>Participantes PJ</legend>
            {choices.length ? <div className="pj-contract-choices">
              {choices.map(({ id, nome }) => (
                <label key={id}>
                  <input type="checkbox" checked={form.participantes.includes(id)} onChange={(event) => {
                    const { checked } = event.target;
                    setForm((current) => ({
                      ...current,
                      participantes: checked ? [...current.participantes, id] : current.participantes.filter((member) => member !== id),
                    }));
                  }} />
                  <span>{nome}</span>
                </label>
              ))}
            </div> : <p className="text-muted">Nenhum funcionário PJ ativo para vincular.</p>}
          </fieldset>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar contrato'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ContractItem({ contract, employeeId, admin, readOnly, busy, onEdit, onChangeStatus }) {
  const completed = Boolean(contract.concluido_em);
  const late = !completed && contract.prazo && contract.prazo < getTodayInSP();
  const team = contract.participantes?.map((person) => person.funcionario?.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return (
    <li className="pj-contract-item">
      <div className="pj-contract-info">
        <div className="pj-contract-title">
          <h4>{contract.nome}</h4>
          <Badge variant={completed ? 'success' : late ? 'warning' : 'info'}>
            {completed ? 'Concluído' : late ? 'Prazo vencido' : 'Em andamento'}
          </Badge>
        </div>
        <div className="pj-contract-meta">
          {contract.referencia && <span>Referência {contract.referencia}</span>}
          {contract.prazo && <span>Prazo em {formatDate(contract.prazo)}</span>}
          {completed && <span>{contract.concluido_por === employeeId ? 'Você concluiu em' : 'Concluído em'} {formatDateTime(contract.concluido_em)}</span>}
        </div>
        {contract.descricao && <p className="pj-contract-description">{contract.descricao}</p>}
        {admin && <p className="pj-contract-meta">{team.length ? team.join(', ') : 'Sem participantes'}</p>}
      </div>
      {!readOnly && <div className="pj-contract-actions">
        {admin && !completed && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onEdit(contract)}>Editar</button>}
        {(!completed || admin) && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onChangeStatus(contract)}>
          {completed ? 'Reabrir projeto' : 'Concluir projeto'}
        </button>}
      </div>}
    </li>
  );
}

export default function PjContracts({ employeeId, admin = false, readOnly = false }) {
  const heading = useId();
  const toast = useToast();
  const [contracts, setContracts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editor, setEditor] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setLoading(true);
    setAttempt((current) => current + 1);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      listContracts(employeeId, admin),
      admin ? fetchAllRows(() => supabase.from('funcionarios').select('id,nome')
        .eq('ativo', true).eq('tipo_contrato', 'pj').eq('role', 'employee').order('nome').order('id')) : [],
    ]).then(([nextContracts, nextEmployees]) => {
      if (active) {
        setContracts(nextContracts);
        setEmployees(nextEmployees);
      }
    }).catch(() => {
      if (active) setLoadError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [employeeId, admin, attempt]);

  async function saveContract(form) {
    if (!editor || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('salvar_contrato_pj', {
        p_id: editor.id ?? null,
        p_versao: editor.versao ?? null,
        p_nome: form.nome.trim(),
        p_referencia: form.referencia,
        p_descricao: form.descricao,
        p_prazo: form.prazo || null,
        p_participantes: form.participantes,
      });
      if (error) throw error;
      toast.success(editor.id ? 'Contrato atualizado.' : 'Contrato criado.');
      setEditor(null);
      reload();
    } catch (error) {
      if (error.code === '40001') {
        setEditor(null);
        reload();
      }
      toast.error(error.code === 'P0001' || error.code === '40001' ? error.message : 'Não foi possível salvar o contrato.');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus() {
    if (!statusTarget || busy) return;
    const concluir = !statusTarget.concluido_em;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('atualizar_conclusao_contrato_pj', {
        p_id: statusTarget.id,
        p_versao: statusTarget.versao,
        p_concluir: concluir,
      });
      if (error) throw error;
      toast.success(concluir ? 'Projeto concluído.' : 'Projeto reaberto.');
    } catch (error) {
      toast.error(error.code === '40001' ? error.message : 'Não foi possível atualizar o projeto. Confira seu acesso e tente novamente.');
    } finally {
      reload();
      setBusy(false);
    }
  }

  const completed = contracts.filter((contract) => contract.concluido_em);
  const inProgress = contracts.filter((contract) => !contract.concluido_em);
  const renderContract = (contract) => <ContractItem
    key={contract.id} contract={contract} employeeId={employeeId} admin={admin} readOnly={readOnly}
    busy={busy} onEdit={setEditor} onChangeStatus={setStatusTarget}
  />;
  const reopening = Boolean(statusTarget?.concluido_em);

  return (
    <section className="card pj-contracts" aria-labelledby={heading} aria-busy={loading}>
      <div className="pj-contracts-header">
        <h3 id={heading} className="card-title">{admin ? 'Projetos e equipes' : readOnly ? 'Contratos PJ' : 'Meus contratos PJ'}</h3>
        {admin && <button type="button" className="btn btn-primary btn-sm" disabled={loading || loadError || busy} onClick={() => setEditor({})}>Novo contrato</button>}
      </div>

      {loading ? <Spinner /> : loadError ? <LoadError message="Não foi possível carregar os contratos PJ." onRetry={reload} /> : (
        <>
          {inProgress.length
            ? <ul className="pj-contract-list" aria-label="Projetos em andamento">{inProgress.map(renderContract)}</ul>
            : <p className="text-muted">Nenhum projeto em andamento.</p>}
          {completed.length > 0 && <details className="pj-contract-history">
            <summary>Projetos concluídos ({completed.length})</summary>
            <ul className="pj-contract-list">{completed.map(renderContract)}</ul>
          </details>}
        </>
      )}

      {editor && <ContractEditor contract={editor} employees={employees} onSave={saveContract} onClose={() => { if (!busy) setEditor(null); }} saving={busy} />}
      <ConfirmDialog isOpen={Boolean(statusTarget)} onClose={() => setStatusTarget(null)} onConfirm={changeStatus}
        title={reopening ? 'Reabrir projeto' : 'Concluir projeto'}
        message={reopening
          ? `O projeto “${statusTarget?.nome}” voltará a aparecer como em andamento para toda a equipe.`
          : `O projeto “${statusTarget?.nome}” será marcado como concluído para toda a equipe. A administração poderá reabri-lo.`}
        confirmText={reopening ? 'Reabrir projeto' : 'Concluir projeto'} />
    </section>
  );
}
