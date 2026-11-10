import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { SUPPORT_ARTICLES, SUPPORT_CATEGORIES, normalizeSupportText } from '../../shared/support.mjs';
import { supportRequest } from '../lib/support';
import LegalLinks from '../components/LegalLinks';

export default function SupportPage() {
  const navigate = useNavigate();
  const { session, profile, loading: authLoading } = useAuth();
  const active = Boolean(session && profile?.ativo);
  const [category, setCategory] = useState('acesso');
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const sending = useRef(false);
  const filtered = SUPPORT_ARTICLES.filter((article) => (!search ? article.category === category : normalizeSupportText(`${article.title} ${article.answer}`).includes(normalizeSupportText(search))));

  async function ask(event) {
    event.preventDefault();
    if (sending.current) return;
    setError('');
    if (!active) { setError('Entre na sua conta para enviar o pedido com seu nome e e-mail.'); return; }
    const description = question.trim();
    if (Array.from(description).length < 10) { setError('Descreva o que aconteceu com pelo menos 10 caracteres.'); return; }
    sending.current = true;
    setAsking(true);
    const body = { action: 'create_ticket', category, subject: Array.from(description.replace(/\s+/g, ' ')).slice(0, 120).join(''), description };
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await supportRequest({ ...body, request_id: request.current.id });
      if (!result?.ticket?.id) throw new Error('Não foi possível confirmar o chamado. Tente novamente.');
      request.current = null;
      setQuestion('');
      navigate('/suporte/confirmacao', { state: { supportProtocol: result.ticket.protocol } });
    } catch (err) { setError(err.message); }
    finally { sending.current = false; setAsking(false); }
  }

  return <div className="support-page">
    <header className="support-header">
      <Link className="marketing-brand" to="/" aria-label="KairoPont, início"><img src={`${import.meta.env.BASE_URL}assets/brand/web/mark-96.webp`} width="42" height="42" alt="" /><span><strong>KairoPont</strong><small>Central de ajuda</small></span></Link>
      <Link className="btn btn-secondary" to={active ? (profile.role === 'admin' ? '/admin' : '/ponto') : '/login'}>{active ? 'Voltar ao portal' : 'Acessar minha conta'}</Link>
    </header>
    <main className="support-main">
      <section className="support-intro"><div><h1>Como podemos ajudar?</h1></div><span className="support-availability">Base de ajuda disponível 24h</span></section>
      <div className="support-workspace">
        <section className="support-guides" aria-labelledby="guides-title">
          <h2 id="guides-title">Resolva por aqui</h2>
          <label className="support-search" htmlFor="support-search"><span className="form-label">Buscar na ajuda</span><input className="form-input" id="support-search" type="search" placeholder="Senha, ponto, PDF…" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="support-topics" role="group" aria-label="Temas da ajuda">{SUPPORT_CATEGORIES.map((item) => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setSearch(''); }} disabled={asking}>{item.label}</button>)}</div>
          <div className="support-articles">{filtered.map((article) => <details key={article.id}><summary>{article.title}</summary><p>{article.answer}</p><ol>{article.steps.map((step) => <li key={step}>{step}</li>)}</ol><Link to={article.link.to}>{article.link.label}</Link></details>)}</div>
          {filtered.length === 0 && <p className="support-empty">{category === 'outro' && !search ? 'Correções de jornada, férias e dados pessoais precisam da análise da equipe. Abra um chamado na sua conta.' : 'Nenhuma orientação encontrada. Tente outro termo ou descreva sua dúvida ao lado.'}</p>}
          <p className="support-guides-note">Correções de dados e registros devem ser solicitadas à equipe.</p>
        </section>
        <aside className="support-contact" aria-labelledby="support-contact-title">
          <h2 id="support-contact-title">Descreva sua dúvida</h2>
          <form onSubmit={ask} aria-busy={asking}><label className="form-group" htmlFor="support-question"><span className="form-label">O que você precisa resolver?</span><textarea className="form-input" id="support-question" rows={5} required minLength={10} maxLength={3000} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={asking} /></label><button className="btn btn-primary" type="submit" disabled={asking || authLoading}>{asking ? 'Enviando pedido…' : 'Buscar orientação'}</button></form>
          {error && <p role="alert" className="support-error">{error}</p>}
          {!active && !authLoading && <p className="support-guides-note"><Link to="/login">Entre na sua conta</Link> para enviar o pedido.</p>}
        </aside>
      </div>
    </main>
    <footer className="support-footer"><span>Kairo Automações · KairoPont</span><LegalLinks /></footer>
  </div>;
}
