import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { validateCPF, maskCPF } from '../lib/utils';
import { Spinner } from '../components/ui';

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [loginType, setLoginType] = useState('email'); // 'email' | 'cpf'
  const [loading, setLoading] = useState(false);
  const { signInWithEmail, signInWithCPF, signUp } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginCPF, setLoginCPF] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form state
  const [regNome, setRegNome] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regCPF, setRegCPF] = useState('');
  const [regCargo, setRegCargo] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (loginType === 'email') {
        if (!loginEmail || !loginPassword) {
          toast.warning('Preencha todos os campos.');
          return;
        }
        await signInWithEmail(loginEmail, loginPassword);
      } else {
        const cleanCPF = loginCPF.replace(/\D/g, '');
        if (!validateCPF(cleanCPF)) {
          toast.error('CPF inválido.');
          return;
        }
        if (!loginPassword) {
          toast.warning('Preencha a senha.');
          return;
        }
        await signInWithCPF(loginCPF, loginPassword);
      }
      toast.success('Login realizado com sucesso!');
      navigate('/ponto');
    } catch (err) {
      toast.error(err.message || 'Erro ao fazer login. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (!regNome || !regEmail || !regCPF || !regCargo || !regPassword) {
        toast.warning('Preencha todos os campos obrigatórios.');
        return;
      }

      const cleanCPF = regCPF.replace(/\D/g, '');
      if (!validateCPF(cleanCPF)) {
        toast.error('CPF inválido.');
        return;
      }

      if (regPassword.length < 6) {
        toast.error('A senha deve ter pelo menos 6 caracteres.');
        return;
      }

      if (regPassword !== regConfirmPassword) {
        toast.error('As senhas não coincidem.');
        return;
      }

      await signUp({
        email: regEmail,
        password: regPassword,
        nome: regNome,
        cpf: cleanCPF,
        cargo: regCargo,
      });

      toast.success('Cadastro realizado! Verifique seu e-mail para confirmar a conta.');
      setMode('login');
    } catch (err) {
      toast.error(err.message || 'Erro ao cadastrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Lado da marca */}
      <div className="login-brand">
        <div className="login-brand-content">
          <img src={`${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`} alt="Kairo Automações" />
          <h2>Controle de Ponto</h2>
          <p>Onde automação vira sistema confiável.</p>
        </div>
      </div>

      {/* Formulário */}
      <div className="login-form-container">
        {mode === 'login' ? (
          <div className="login-form">
            <h1>Entrar</h1>
            <p className="login-subtitle">
              Acesse sua conta para registrar o ponto
            </p>

            {/* Tabs Email/CPF */}
            <div className="login-tabs">
              <button
                className={`login-tab ${loginType === 'email' ? 'active' : ''}`}
                onClick={() => setLoginType('email')}
              >
                E-mail
              </button>
              <button
                className={`login-tab ${loginType === 'cpf' ? 'active' : ''}`}
                onClick={() => setLoginType('cpf')}
              >
                CPF
              </button>
            </div>

            <form onSubmit={handleLogin}>
              {loginType === 'email' ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="login-email">E-mail corporativo</label>
                  <input
                    id="login-email"
                    type="email"
                    className="form-input"
                    placeholder="seu.nome@kairoautomacoes.com.br"
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label" htmlFor="login-cpf">CPF</label>
                  <input
                    id="login-cpf"
                    type="text"
                    className="form-input"
                    placeholder="000.000.000-00"
                    value={loginCPF}
                    onChange={e => setLoginCPF(maskCPF(e.target.value))}
                    disabled={loading}
                    inputMode="numeric"
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="login-password">Senha</label>
                <input
                  id="login-password"
                  type="password"
                  className="form-input"
                  placeholder="Sua senha"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-block btn-lg"
                disabled={loading}
              >
                {loading ? <Spinner /> : 'Entrar'}
              </button>
            </form>

            <div className="login-divider">ou</div>

            <button
              className="btn btn-secondary btn-block"
              onClick={() => setMode('register')}
              disabled={loading}
            >
              Criar nova conta
            </button>
          </div>
        ) : (
          <div className="login-form">
            <h1>Cadastro</h1>
            <p className="login-subtitle">
              Crie sua conta para começar a registrar o ponto
            </p>

            <form onSubmit={handleRegister}>
              <div className="form-group">
                <label className="form-label" htmlFor="reg-nome">Nome completo *</label>
                <input
                  id="reg-nome"
                  type="text"
                  className="form-input"
                  placeholder="Seu nome completo"
                  value={regNome}
                  onChange={e => setRegNome(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="reg-email">E-mail corporativo *</label>
                <input
                  id="reg-email"
                  type="email"
                  className="form-input"
                  placeholder="seu.nome@kairoautomacoes.com.br"
                  value={regEmail}
                  onChange={e => setRegEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="reg-cpf">CPF *</label>
                  <input
                    id="reg-cpf"
                    type="text"
                    className="form-input"
                    placeholder="000.000.000-00"
                    value={regCPF}
                    onChange={e => setRegCPF(maskCPF(e.target.value))}
                    disabled={loading}
                    inputMode="numeric"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="reg-cargo">Cargo *</label>
                  <input
                    id="reg-cargo"
                    type="text"
                    className="form-input"
                    placeholder="Ex: Técnico de Automação"
                    value={regCargo}
                    onChange={e => setRegCargo(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="reg-password">Senha *</label>
                  <input
                    id="reg-password"
                    type="password"
                    className="form-input"
                    placeholder="Mínimo 6 caracteres"
                    value={regPassword}
                    onChange={e => setRegPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="reg-confirm-password">Confirmar senha *</label>
                  <input
                    id="reg-confirm-password"
                    type="password"
                    className="form-input"
                    placeholder="Repita a senha"
                    value={regConfirmPassword}
                    onChange={e => setRegConfirmPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-block btn-lg"
                disabled={loading}
              >
                {loading ? <Spinner /> : 'Cadastrar'}
              </button>
            </form>

            <div className="login-divider">ou</div>

            <button
              className="btn btn-secondary btn-block"
              onClick={() => setMode('login')}
              disabled={loading}
            >
              Já tenho uma conta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
