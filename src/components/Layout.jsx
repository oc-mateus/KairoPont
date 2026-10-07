import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from './ui';

const ClockIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const ChartIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 17v-4"/><path d="M12 17V9"/><path d="M17 17v-8"/></svg>;
const DocIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>;
const UserIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const DashboardIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>;
const UsersIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
export const LogoutIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;

const employeeNav = [
  { id: 'ponto', label: 'Registrar Ponto', icon: ClockIcon, path: '/ponto' },
  { id: 'historico', label: 'Meu Histórico', icon: ChartIcon, path: '/historico' },
  { id: 'documentos', label: 'Documentos', icon: DocIcon, path: '/documentos' },
  { id: 'perfil', label: 'Meu Perfil', icon: UserIcon, path: '/perfil' },
];

const adminNav = [
  { id: 'admin-dashboard', label: 'Painel Admin', icon: DashboardIcon, path: '/admin' },
  { id: 'admin-funcionarios', label: 'Funcionários', icon: UsersIcon, path: '/admin/funcionarios' },
];

export default function Layout({ children }) {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNav = (path) => {
    navigate(path);
    setSidebarOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const currentPageTitle = () => {
    const allNav = [...employeeNav, ...adminNav];
    const current = allNav.find(item => location.pathname === item.path);
    return current?.label || 'KairoPont';
  };

  return (
    <div className="app-layout">
      {/* Overlay para mobile */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src={`${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`} alt="Kairo" />
          <span>KairoPont</span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-group-title">Funcionário</div>
            {employeeNav.map(item => (
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

          {isAdmin && (
            <div className="sidebar-nav-group">
              <div className="sidebar-nav-group-title">Administração</div>
              {adminNav.map(item => (
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
            <div className="user-role">{isAdmin ? 'Administrador' : 'Funcionário'}</div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={handleSignOut}
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
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <h1 className="app-header-title">{currentPageTitle()}</h1>
          </div>
        </header>
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
