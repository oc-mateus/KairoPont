import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from './ui';

const employeeNav = [
  { id: 'ponto', label: 'Registrar Ponto', icon: '🕐', path: '/ponto' },
  { id: 'historico', label: 'Meu Histórico', icon: '📊', path: '/historico' },
  { id: 'documentos', label: 'Documentos', icon: '📄', path: '/documentos' },
  { id: 'perfil', label: 'Meu Perfil', icon: '👤', path: '/perfil' },
];

const adminNav = [
  { id: 'admin-dashboard', label: 'Painel Admin', icon: '📈', path: '/admin' },
  { id: 'admin-funcionarios', label: 'Funcionários', icon: '👥', path: '/admin/funcionarios' },
  { id: 'admin-registros', label: 'Registros de Ponto', icon: '📋', path: '/admin/registros' },
  { id: 'admin-documentos', label: 'Documentos', icon: '📁', path: '/admin/documentos' },
  { id: 'admin-auditoria', label: 'Auditoria', icon: '🔍', path: '/admin/auditoria' },
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
            🚪
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
