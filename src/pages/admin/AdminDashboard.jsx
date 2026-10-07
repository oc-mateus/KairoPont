import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { calcDailyTotal, formatTime, getTodayInSP } from '../../lib/utils';
import { Avatar, Badge, Spinner } from '../../components/ui';

function Icon({ children, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

const UsersIcon = () => <Icon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Icon>;
const ClockIcon = () => <Icon><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></Icon>;
const FileIcon = () => <Icon><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></Icon>;
const ArrowIcon = () => <Icon size={16}><polyline points="9 18 15 12 9 6"/></Icon>;

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [documents, setDocuments] = useState([]);
  const today = getTodayInSP();

  useEffect(() => {
    async function fetchOverview() {
      setLoading(true);
      try {
        const [employeesResult, recordsResult, documentsResult] = await Promise.all([
          supabase.from('funcionarios').select('*').order('nome'),
          supabase.from('registros_ponto').select('*').order('data', { ascending: false }),
          supabase.from('documentos').select('*').order('created_at', { ascending: false }),
        ]);
        if (employeesResult.error) throw employeesResult.error;
        if (recordsResult.error) throw recordsResult.error;
        if (documentsResult.error) throw documentsResult.error;
        setEmployees(employeesResult.data || []);
        setRecords(recordsResult.data || []);
        setDocuments(documentsResult.data || []);
      } catch (error) {
        console.error('Erro ao carregar painel administrativo:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchOverview();
  }, []);

  const overview = useMemo(() => employees.map((employee) => {
    const employeeRecords = records.filter((record) => record.funcionario_id === employee.id);
    const employeeDocuments = documents.filter((document) => document.funcionario_id === employee.id);
    return { employee, todayRecord: employeeRecords.find((record) => record.data === today), totalRecords: employeeRecords.length, documents: employeeDocuments };
  }), [employees, records, documents, today]);

  const activeEmployees = employees.filter((employee) => employee.ativo).length;
  const todayRecords = records.filter((record) => record.data === today).length;

  if (loading) return <div className="flex flex-center" style={{ minHeight: '60vh' }}><Spinner size="lg" /></div>;

  return (
    <div className="admin-dashboard">
      <div className="page-header admin-page-heading">
        <div><span className="eyebrow">Administração</span><h2 className="page-title">Visão geral</h2><p className="page-subtitle">Ponto e documentos organizados por funcionário.</p></div>
        <span className="admin-date">Hoje, {new Date(`${today}T12:00:00`).toLocaleDateString('pt-BR')}</span>
      </div>

      <div className="admin-summary-grid">
        <Link className="admin-summary-card" to="/admin/funcionarios"><span className="admin-summary-icon"><UsersIcon /></span><span className="admin-summary-content"><span>Funcionários ativos</span><strong>{activeEmployees}<small> de {employees.length}</small></strong></span><ArrowIcon /></Link>
        <Link className="admin-summary-card" to="/admin/registros"><span className="admin-summary-icon"><ClockIcon /></span><span className="admin-summary-content"><span>Registros hoje</span><strong>{todayRecords}<small> marcações</small></strong></span><ArrowIcon /></Link>
        <Link className="admin-summary-card" to="/admin/documentos"><span className="admin-summary-icon"><FileIcon /></span><span className="admin-summary-content"><span>Documentos enviados</span><strong>{documents.length}<small> arquivos</small></strong></span><ArrowIcon /></Link>
      </div>

      <section className="admin-people-section">
        <div className="section-heading"><div><h3>Funcionários</h3><p>Informações individuais para conferência rápida.</p></div><Link to="/admin/funcionarios">Gerenciar todos <ArrowIcon /></Link></div>
        <div className="employee-overview-list">
          {overview.map(({ employee, todayRecord, totalRecords, documents: employeeDocuments }) => (
            <article className="employee-overview-card" key={employee.id}>
              <header className="employee-overview-header"><Avatar src={employee.foto_url} name={employee.nome} /><div className="employee-overview-name"><h4>{employee.nome}</h4><p>{employee.cargo || 'Cargo não informado'} · {employee.email}</p></div><Badge variant={employee.ativo ? 'success' : 'neutral'}>{employee.ativo ? 'Ativo' : 'Inativo'}</Badge></header>
              <div className="employee-overview-details">
                <div className="employee-detail-block"><div className="employee-detail-label"><ClockIcon /> Ponto de hoje</div>{todayRecord ? <div className="time-registers"><span>Entrada <b>{formatTime(todayRecord.entrada)}</b></span><span>Almoço <b>{formatTime(todayRecord.saida_almoco)} – {formatTime(todayRecord.retorno_almoco)}</b></span><span>Saída <b>{formatTime(todayRecord.saida)}</b></span><span>Total <b>{calcDailyTotal(todayRecord)}</b></span></div> : <p className="employee-empty">Nenhuma marcação hoje.</p>}<Link className="detail-link" to="/admin/registros">{totalRecords} registro{totalRecords === 1 ? '' : 's'} no histórico <ArrowIcon /></Link></div>
                <div className="employee-detail-block"><div className="employee-detail-label"><FileIcon /> Documentos</div>{employeeDocuments.length ? <ul className="document-mini-list">{employeeDocuments.slice(0, 3).map((document) => <li key={document.id}><span>{document.nome_arquivo}</span><Badge variant={document.tipo === 'atestado' ? 'warning' : 'info'}>{document.tipo}</Badge></li>)}</ul> : <p className="employee-empty">Nenhum documento enviado.</p>}<Link className="detail-link" to="/admin/documentos">Ver documentos <ArrowIcon /></Link></div>
              </div>
            </article>
          ))}
          {!overview.length && <div className="admin-empty">Ainda não há funcionários cadastrados.</div>}
        </div>
      </section>
    </div>
  );
}
