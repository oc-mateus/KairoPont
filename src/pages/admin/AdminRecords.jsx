import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDate, formatTime, calcDailyTotal, calcElapsedDailyTotal } from '../../lib/utils';
import { Spinner, Badge } from '../../components/ui';
import { getFixedLunchLabel, getShiftLabel, inferShiftFromEntry } from '../../lib/workShifts';

export default function AdminRecords() {
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('registros_ponto')
        .select('*, funcionarios(nome, cpf, tipo_contrato)')
        .order('data', { ascending: false })
        .limit(100);

      if (error) throw error;
      setRecords(data || []);
    } catch (err) {
      toast.error('Erro ao carregar registros: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Registros de Ponto</h2>
        <p className="page-subtitle">Últimos 100 registros de todos os funcionários.</p>
      </div>

      {loading ? (
        <div className="flex flex-center" style={{ minHeight: '40vh' }}><Spinner size="lg" /></div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>Vínculo</th>
                <th>Data</th>
                <th>Entrada</th>
                <th>Turno / almoço fixo</th>
                <th>Saída</th>
                <th>Horas computadas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.funcionarios?.nome}</td>
                  <td><Badge variant={r.funcionarios?.tipo_contrato === 'pj' ? 'info' : 'neutral'}>{r.funcionarios?.tipo_contrato === 'pj' ? 'PJ' : 'CLT'}</Badge></td>
                  <td>{formatDate(r.data + 'T00:00:00')}</td>
                  <td>{formatTime(r.entrada)}</td>
                  <td>{r.funcionarios?.tipo_contrato === 'pj' ? '—' : `${getShiftLabel(r.turno_trabalhado || inferShiftFromEntry(r.entrada))} · ${getFixedLunchLabel(r.turno_trabalhado || inferShiftFromEntry(r.entrada), r.data)}`}</td>
                  <td>{formatTime(r.saida)}</td>
                  <td><strong>{r.funcionarios?.tipo_contrato === 'pj' ? calcElapsedDailyTotal(r) : calcDailyTotal(r)}</strong></td>
                  <td>
                    <Badge variant={r.saida ? 'success' : 'warning'}>
                      {r.saida ? 'Completo' : 'Incompleto'}
                    </Badge>
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
