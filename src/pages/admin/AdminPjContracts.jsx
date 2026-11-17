import PjContracts from '../../components/PjContracts';
import { useAuth } from '../../contexts/AuthContext';

export default function AdminPjContracts() {
  const { profile } = useAuth();

  return (
    <div>
      <header className="page-header">
        <h2 className="page-title">Contratos PJ</h2>
      </header>
      <PjContracts key={profile.id} employeeId={profile.id} admin />
    </div>
  );
}
