import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner, Badge } from '../../components/ui';

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    activeEmployees: 0,
    todayRecords: 0,
    pendingDocs: 0
  });

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      try {
        // Obter total e ativos (funcionarios)
        const { data: funcData } = await supabase.from('funcionarios').select('ativo');
        const totalEmployees = funcData?.length || 0;
        const activeEmployees = funcData?.filter(f => f.ativo).length || 0;

        // Obter registros de hoje (aproximação simples)
        const today = new Date().toISOString().split('T')[0];
        const { count: todayRecords } = await supabase
          .from('registros_ponto')
          .select('*', { count: 'exact', head: true })
          .eq('data', today);

        // Documentos recentes (ex: atestados a verificar - simplificado para total)
        const { count: pendingDocs } = await supabase
          .from('documentos')
          .select('*', { count: 'exact', head: true });

        setStats({
          totalEmployees,
          activeEmployees,
          todayRecords: todayRecords || 0,
          pendingDocs: pendingDocs || 0
        });
      } catch (err) {
        console.error('Erro ao carregar dashboard', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (loading) {
    return <div className="flex flex-center" style={{ minHeight: '60vh' }}><Spinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Painel de Controle</h2>
        <p className="page-subtitle">Visão geral do sistema de ponto</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-6)' }}>
        <div className="card">
          <div style={{ fontSize: 'var(--font-3xl)', marginBottom: 'var(--space-2)' }}>👥</div>
          <h3 className="card-title">Funcionários</h3>
          <p style={{ fontSize: 'var(--font-2xl)', fontWeight: 700, margin: 'var(--space-2) 0' }}>
            {stats.activeEmployees} <span className="text-muted" style={{ fontSize: 'var(--font-base)' }}>/ {stats.totalEmployees} ativos</span>
          </p>
        </div>

        <div className="card">
          <div style={{ fontSize: 'var(--font-3xl)', marginBottom: 'var(--space-2)' }}>📋</div>
          <h3 className="card-title">Registros Hoje</h3>
          <p style={{ fontSize: 'var(--font-2xl)', fontWeight: 700, margin: 'var(--space-2) 0' }}>
            {stats.todayRecords}
          </p>
        </div>

        <div className="card">
          <div style={{ fontSize: 'var(--font-3xl)', marginBottom: 'var(--space-2)' }}>📁</div>
          <h3 className="card-title">Documentos</h3>
          <p style={{ fontSize: 'var(--font-2xl)', fontWeight: 700, margin: 'var(--space-2) 0' }}>
            {stats.pendingDocs} <span className="text-muted" style={{ fontSize: 'var(--font-base)' }}>enviados</span>
          </p>
        </div>
      </div>
    </div>
  );
}
