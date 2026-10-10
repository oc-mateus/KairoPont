import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/ui';

export default function SetPasswordPage() {
  const { session, loading: authLoading, clearPasswordRecovery } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);

  const setNewPassword = async (event) => {
    event.preventDefault();
    if (password.length < 8) return toast.warning('A senha deve ter pelo menos 8 caracteres.');
    if (password !== confirmation) return toast.warning('As senhas não coincidem.');
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      clearPasswordRecovery();
      toast.success('Senha atualizada com sucesso.');
      navigate('/ponto', { replace: true });
    } catch (error) {
      toast.error(error.message || 'Não foi possível atualizar sua senha. Solicite um novo link de recuperação.');
    } finally { setSaving(false); }
  };

  return <div className="login-page">
    <div className="login-brand"><div className="login-brand-content"><img src={`${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`} alt="Kairo Automações" /><h2>KairoPont</h2><p>Controle de ponto e jornada</p></div></div>
    <div className="login-form-container"><div className="login-form">
      <h1>Definir senha</h1>
      {authLoading ? <div className="flex flex-center" style={{ minHeight: 120 }}><Spinner size="lg" /></div> : session ? <>
        <p className="login-subtitle">Crie uma nova senha para acessar sua conta do KairoPont.</p>
        <form onSubmit={setNewPassword}>
          <div className="form-group"><label className="form-label" htmlFor="new-password">Nova senha</label><input id="new-password" className="form-input" type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={saving} /></div>
          <div className="form-group"><label className="form-label" htmlFor="confirm-password">Confirmar senha</label><input id="confirm-password" className="form-input" type="password" minLength={8} required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={saving} /></div>
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={saving}>{saving ? <Spinner /> : 'Salvar senha'}</button>
        </form>
      </> : <>
        <p className="login-subtitle">Este link expirou, já foi usado ou não foi aberto no mesmo navegador. Solicite um novo link para redefinir a senha.</p>
        <button className="btn btn-primary btn-block btn-lg" type="button" onClick={() => navigate('/recuperar-senha')}>Solicitar novo link</button>
      </>}
    </div></div>
  </div>;
}
