import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDate, formatTime, calcDailyTotal } from '../../lib/utils';
import { Spinner, Badge } from '../../components/ui';

export default function AdminRecords() {
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('registros_ponto')
        .select('*, funcionarios(nome, cpf)')
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
                <th>Data</th>
                <th>Entrada</th>
                <th>Saída Almoço</th>
                <th>Retorno Almoço</th>
                <th>Saída</th>
                <th>Horas computadas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.funcionarios?.nome}</td>
                  <td>{formatDate(r.data + 'T00:00:00')}</td>
                  <td>{formatTime(r.entrada)}</td>
                  <td>{formatTime(r.saida_almoco)}</td>
                  <td>{formatTime(r.retorno_almoco)}</td>
                  <td>{formatTime(r.saida)}</td>
                  <td><strong>{calcDailyTotal(r)}</strong></td>
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
