import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';

// Pages
import LoginPage from './pages/LoginPage';
import PunchPage from './pages/PunchPage';
import HistoryPage from './pages/HistoryPage';
import DocumentsPage from './pages/DocumentsPage';
import ProfilePage from './pages/ProfilePage';
import VacationsPage from './pages/VacationsPage';
import SetPasswordPage from './pages/SetPasswordPage';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminEmployees from './pages/admin/AdminEmployees';

function PrivateRoute({ children, requireAdmin = false }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex flex-center" style={{ minHeight: '100vh' }}><Spinner size="lg" /></div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && profile?.role !== 'admin') {
    return <Navigate to="/ponto" replace />;
  }

  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }) {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="flex flex-center" style={{ minHeight: '100vh' }}><Spinner size="lg" /></div>;
  }

  if (session) {
    return <Navigate to="/ponto" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/definir-senha" element={<SetPasswordPage />} />

      {/* Rotas de Funcionário */}
      <Route path="/ponto" element={<PrivateRoute><PunchPage /></PrivateRoute>} />
      <Route path="/historico" element={<PrivateRoute><HistoryPage /></PrivateRoute>} />
      <Route path="/documentos" element={<PrivateRoute><DocumentsPage /></PrivateRoute>} />
      <Route path="/perfil" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
      <Route path="/ferias" element={<PrivateRoute><VacationsPage /></PrivateRoute>} />

      {/* Rotas de Administração */}
      <Route path="/admin" element={<PrivateRoute requireAdmin><AdminDashboard /></PrivateRoute>} />
      <Route path="/admin/funcionarios" element={<PrivateRoute requireAdmin><AdminEmployees /></PrivateRoute>} />

      <Route path="*" element={<Navigate to="/ponto" replace />} />
    </Routes>
  );
}
