import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Avatar } from './ui';
import InstallAppButton from './InstallAppButton';
import LegalLinks from './LegalLinks';
import { useToast } from '../contexts/ToastContext';

const SupportIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></svg>;

const ClockIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const ChartIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 17v-4"/><path d="M12 17V9"/><path d="M17 17v-8"/></svg>;
const DocIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>;
const UserIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const DashboardIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>;
const UsersIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const VacationIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h3"/></svg>;
const CalendarIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>;
export const LogoutIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;

const employeeNav = [
  { id: 'ponto', label: 'Registrar Ponto', icon: ClockIcon, path: '/ponto' },
  { id: 'historico', label: 'Meu Histórico', icon: ChartIcon, path: '/historico' },
  { id: 'documentos', label: 'Documentos', icon: DocIcon, path: '/documentos' },
  { id: 'ferias', label: 'Minhas Férias', icon: VacationIcon, path: '/ferias' },
  { id: 'perfil', label: 'Meu Perfil', icon: UserIcon, path: '/perfil' },
  { id: 'suporte', label: 'Ajuda e suporte', icon: SupportIcon, path: '/suporte' },
  { id: 'atendimentos', label: 'Atendimentos', icon: SupportIcon, path: '/admin/suporte' },
];

const adminNav = [
  { id: 'admin-dashboard', label: 'Painel Admin', icon: DashboardIcon, path: '/admin' },
  { id: 'admin-funcionarios', label: 'Funcionários', icon: UsersIcon, path: '/admin/funcionarios' },
  { id: 'admin-calendario', label: 'Calendário de feriados', icon: CalendarIcon, path: '/admin/calendario' },
  { id: 'admin-auditoria', label: 'Auditoria', icon: ChartIcon, path: '/admin/auditoria' },
  { id: 'admin-suporte', label: 'Atendimentos', icon: SupportIcon, path: '/admin/suporte' },
  { id: 'admin-ferias', label: 'Férias', icon: VacationIcon, path: '/ferias' },
];

const adminAccountNav = employeeNav.filter(item => ['perfil', 'suporte'].includes(item.id));

export default function Layout({ children, offlineProfile }) {
  const { profile: liveProfile, isAdmin, isSupport, signOut } = useAuth();
  const profile = offlineProfile ?? liveProfile;
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const visibleEmployeeNav = employeeNav.filter(item =>
    (!offlineProfile || item.id === 'ponto')
    && (item.id !== 'atendimentos' || isSupport)
    && (profile?.tipo_contrato !== 'pj' || !['documentos', 'ferias'].includes(item.id)));
  const visibleAdminNav = adminNav.filter(item => item.id !== 'admin-suporte' || isSupport);

  const handleNav = (path) => {
    navigate(path);
    setSidebarOpen(false);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } catch {
      toast.error('Não foi possível sair. Confira sua conexão e tente novamente.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">Pular para o conteúdo principal</a>
      {/* Overlay para mobile */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src={`${import.meta.env.BASE_URL}assets/brand/web/mark-96.webp`} width="42" height="42" alt="" />
          <span className="brand-wordmark"><strong>KairoPont</strong><small>Controle de ponto</small></span>
        </div>

        <nav className="sidebar-nav">
          {!isAdmin && <div className="sidebar-nav-group">
            <div className="sidebar-nav-group-title">Funcionário</div>
            {visibleEmployeeNav.map(item => (
              <button
                key={item.id}
                className={`sidebar-nav-item ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => handleNav(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>}

          {isAdmin && <div className="sidebar-nav-group">
            <div className="sidebar-nav-group-title">Conta</div>
            {adminAccountNav.map(item => (
              <button
                key={item.id}
                className={`sidebar-nav-item ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => handleNav(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>}

          {isAdmin && (
            <div className="sidebar-nav-group">
              <div className="sidebar-nav-group-title">Administração</div>
              {visibleAdminNav.map(item => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => handleNav(item.path)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="sidebar-user">
          <Avatar
            src={profile?.foto_url}
            name={profile?.nome}
            size="sm"
          />
          <div className="sidebar-user-info">
            <div className="user-name">{profile?.nome || 'Usuário'}</div>
            <div className="user-role">{isSupport ? (isAdmin ? 'Administrador · Suporte' : 'Suporte') : isAdmin ? 'Administrador' : 'Funcionário'}</div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sair da conta"
            title="Sair"
          >
            {LogoutIcon}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="app-main">
        <header className="app-header">
          <div className="flex gap-3" style={{ alignItems: 'center' }}>
            <button
              className="menu-toggle"
              aria-label="Abrir menu de navegação"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
          </div>
          <div className="app-header-actions">
            <button
              className="btn btn-ghost btn-icon theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={`Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
              title={`Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
            >
              {theme === 'dark'
                ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z"/></svg>}
            </button>
            <InstallAppButton compact />
          </div>
        </header>
        <main id="main-content" className="app-content" tabIndex={-1}>
          {children}
        </main>
        <LegalLinks className="app-legal-links" />
      </div>
    </div>
  );
}
