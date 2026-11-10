import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const PunchPage = lazy(() => import('./pages/PunchPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const VacationsPage = lazy(() => import('./pages/VacationsPage'));
const RecoverPasswordPage = lazy(() => import('./pages/RecoverPasswordPage'));
const SetPasswordPage = lazy(() => import('./pages/SetPasswordPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const AdminSupport = lazy(() => import('./pages/admin/AdminSupport'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminEmployees = lazy(() => import('./pages/admin/AdminEmployees'));
const AdminCalendar = lazy(() => import('./pages/admin/AdminCalendar'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));

function PrivateRoute({ children, requireAdmin = false, requireClt = false }) {
  const { session, profile, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex flex-center" style={{ minHeight: '100vh' }}><Spinner size="lg" /></div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profile?.ativo === false) {
    return (
      <div className="login-page">
        <section className="card" style={{ maxWidth: 480, margin: 'auto' }}>
          <h1 className="card-title">Acesso desativado</h1>
          <p className="text-muted">Esta conta está inativa. Fale com a equipe administrativa se precisar de ajuda.</p>
          <button className="btn btn-primary" onClick={() => signOut().catch(() => {})}>Sair da conta</button>
        </section>
      </div>
    );
  }

  if (requireAdmin && profile?.role !== 'admin') {
    return <Navigate to="/ponto" replace />;
  }

  if (requireClt && profile?.role !== 'admin' && profile?.tipo_contrato !== 'clt') {
    return <Navigate to="/ponto" replace />;
  }

  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <div className="flex flex-center" style={{ minHeight: '100vh' }}><Spinner size="lg" /></div>;
  }

  if (session) {
    return <Navigate to={profile?.role === 'admin' ? '/admin' : '/ponto'} replace />;
  }

  return children;
}

export default function App() {
  const { passwordRecoveryPending } = useAuth();
  const location = useLocation();

  if (passwordRecoveryPending && !['/definir-senha', '/privacidade', '/termos'].includes(location.pathname)) {
    return <Navigate to="/definir-senha" replace />;
  }

  return (
    <Suspense fallback={<div className="flex flex-center" style={{ minHeight: '100vh' }}><Spinner size="lg" /></div>}>
      <Routes>
        <Route path="/" element={<MarketingPage />} />
        <Route path="/suporte" element={<SupportPage />} />
        <Route path="/privacidade" element={<LegalPage type="privacy" />} />
        <Route path="/termos" element={<LegalPage type="terms" />} />
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/recuperar-senha" element={<RecoverPasswordPage />} />
        <Route path="/definir-senha" element={<SetPasswordPage />} />

        {/* Rotas de Funcionário */}
        <Route path="/ponto" element={<PrivateRoute><PunchPage /></PrivateRoute>} />
        <Route path="/historico" element={<PrivateRoute><HistoryPage /></PrivateRoute>} />
        <Route path="/documentos" element={<PrivateRoute requireClt><DocumentsPage /></PrivateRoute>} />
        <Route path="/perfil" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/ferias" element={<PrivateRoute requireClt><VacationsPage /></PrivateRoute>} />

        {/* Rotas de Administração */}
        <Route path="/admin" element={<PrivateRoute requireAdmin><AdminDashboard /></PrivateRoute>} />
        <Route path="/admin/funcionarios" element={<PrivateRoute requireAdmin><AdminEmployees /></PrivateRoute>} />
        <Route path="/admin/calendario" element={<PrivateRoute requireAdmin><AdminCalendar /></PrivateRoute>} />
        <Route path="/admin/auditoria" element={<PrivateRoute requireAdmin><AdminAudit /></PrivateRoute>} />
        <Route path="/admin/suporte" element={<PrivateRoute requireAdmin><AdminSupport /></PrivateRoute>} />

        <Route path="*" element={<Navigate to="/ponto" replace />} />
      </Routes>
    </Suspense>
  );
}
