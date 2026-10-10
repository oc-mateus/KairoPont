import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';

export default function RecoverPasswordPage() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const toast = useToast();

  const requestRecovery = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return toast.warning('Informe o e-mail da sua conta.');

    setSending(true);
    try {
      const redirectTo = new URL(
        `${import.meta.env.BASE_URL}definir-senha`,
        window.location.origin,
      ).toString();
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (error) throw error;
      setSent(true);
    } catch (error) {
      toast.error(error.message || 'Não foi possível enviar o link de recuperação. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  return <div className="login-page">
    <div className="login-brand"><div className="login-brand-content"><img src={`${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`} alt="Kairo Automações" /><h2>KairoPont</h2><p>Controle de ponto e jornada</p></div></div>
    <div className="login-form-container"><div className="login-form">
      <h1>Redefinir senha</h1>
      {sent ? <>
        <p className="login-subtitle">Se houver uma conta vinculada a esse e-mail, enviaremos um link para você criar uma nova senha. Abra o link no mesmo navegador em que deseja acessar o KairoPont.</p>
        <Link className="btn btn-primary btn-block btn-lg password-recovery-back" to="/login">Voltar para o login</Link>
      </> : <>
        <p className="login-subtitle">Informe o e-mail da conta. O mesmo processo atende administradores, funcionários CLT e prestadores PJ.</p>
        <form onSubmit={requestRecovery}>
          <div className="form-group"><label className="form-label" htmlFor="recovery-email">E-mail da conta</label><input id="recovery-email" className="form-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={sending} /></div>
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={sending}>{sending ? <Spinner /> : 'Enviar link de recuperação'}</button>
        </form>
        <Link className="password-recovery-back" to="/login">Voltar para o login</Link>
      </>}
    </div></div>
  </div>;
}
