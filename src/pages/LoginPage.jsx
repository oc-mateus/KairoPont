import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Spinner } from '../components/ui';
import InstallAppButton from '../components/InstallAppButton';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { signInWithEmail } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      if (!loginEmail || !loginPassword) {
        toast.warning('Preencha todos os campos.');
        return;
      }
      await signInWithEmail(loginEmail, loginPassword);
      toast.success('Login realizado com sucesso!');
      navigate('/ponto');
    } catch (error) {
      toast.error(error.message || 'Erro ao fazer login. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="login-brand-content">
          <img src={`${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`} alt="Kairo Automações" />
          <h2>Controle de Ponto</h2>
          <p>Onde automação vira sistema confiável.</p>
          <InstallAppButton />
        </div>
      </div>
      <div className="login-form-container">
        <div className="login-form">
          <h1>Entrar</h1>
          <p className="login-subtitle">Acesse sua conta para registrar o ponto</p>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">E-mail corporativo</label>
              <input id="login-email" type="email" className="form-input" placeholder="seu.nome@kairoautomacoes.com.br" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} disabled={loading} autoComplete="email" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Senha</label>
              <input id="login-password" type="password" className="form-input" placeholder="Sua senha" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} disabled={loading} autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>{loading ? <Spinner /> : 'Entrar'}</button>
          </form>
          <p className="login-subtitle" style={{ marginTop: 24 }}>Contas criadas exclusivamente pelo administrador. Se ainda não recebeu um convite, solicite acesso à equipe administrativa.</p>
        </div>
      </div>
    </div>
  );
}
