import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCPF } from '../../lib/utils';
import { Spinner, Badge, Avatar, ConfirmDialog } from '../../components/ui';

export default function AdminEmployees() {
  const toast = useToast();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [actionType, setActionType] = useState(''); // 'toggle_status', 'toggle_role'

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('funcionarios')
        .select('*')
        .order('nome');
      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      toast.error('Erro ao carregar funcionários: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleActionClick = (emp, type) => {
    setSelectedEmp(emp);
    setActionType(type);
    setDialogOpen(true);
  };

  const confirmAction = async () => {
    if (!selectedEmp) return;
    try {
      if (actionType === 'toggle_status' || actionType === 'toggle_role') {
        const { error } = await supabase.rpc('admin_update_employee', {
          p_funcionario_id: selectedEmp.id,
          p_ativo: actionType === 'toggle_status' ? !selectedEmp.ativo : selectedEmp.ativo,
          p_role: actionType === 'toggle_role'
            ? (selectedEmp.role === 'admin' ? 'employee' : 'admin')
            : selectedEmp.role,
        });
        if (error) throw error;
      }

      if (actionType === 'toggle_status') {
        toast.success(`Status de ${selectedEmp.nome} alterado com sucesso!`);
      } else if (actionType === 'toggle_role') {
        const newRole = selectedEmp.role === 'admin' ? 'employee' : 'admin';
        toast.success(`Perfil de ${selectedEmp.nome} alterado para ${newRole}!`);
      }
      fetchEmployees();
    } catch (err) {
      toast.error('Erro ao realizar ação: ' + err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Gerenciar Funcionários</h2>
        <p className="page-subtitle">Ative, desative ou altere permissões de acesso.</p>
      </div>

      {loading ? (
        <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>CPF</th>
                <th>Cargo</th>
                <th>Status</th>
                <th>Perfil</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td>
                    <div className="flex" style={{ alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Avatar src={emp.foto_url} name={emp.nome} size="sm" />
                      <div>
                        <div style={{ fontWeight: 500 }}>{emp.nome}</div>
                        <div className="text-muted" style={{ fontSize: 'var(--font-xs)' }}>{emp.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{formatCPF(emp.cpf)}</td>
                  <td>{emp.cargo}</td>
                  <td>
                    <Badge variant={emp.ativo ? 'success' : 'danger'}>
                      {emp.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={emp.role === 'admin' ? 'info' : 'neutral'}>
                      {emp.role === 'admin' ? 'Admin' : 'Funcionário'}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleActionClick(emp, 'toggle_status')}
                      title={emp.ativo ? 'Desativar Conta' : 'Ativar Conta'}
                    >
                      {emp.ativo ? '🚫' : '✅'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleActionClick(emp, 'toggle_role')}
                      title={emp.role === 'admin' ? 'Remover Admin' : 'Tornar Admin'}
                    >
                      🛡️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={confirmAction}
        title="Confirmar Ação"
        message={
          actionType === 'toggle_status'
            ? `Deseja realmente ${selectedEmp?.ativo ? 'desativar' : 'ativar'} o acesso de ${selectedEmp?.nome}?`
            : `Deseja alterar o perfil de ${selectedEmp?.nome} para ${selectedEmp?.role === 'admin' ? 'Funcionário' : 'Administrador'}?`
        }
        confirmText="Confirmar"
        danger={actionType === 'toggle_status' && selectedEmp?.ativo}
      />
    </div>
  );
}
