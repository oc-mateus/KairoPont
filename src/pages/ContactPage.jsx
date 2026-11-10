import { Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';
import { CONTACT_EMAIL, SITE_COMPANY, SITE_OWNER } from '../../shared/site.mjs';

export default function ContactPage() {
  return (
    <main className="legal-page">
      <article className="legal-document">
        <header className="legal-header">
          <Link className="marketing-brand" to="/">
            <img src={`${import.meta.env.BASE_URL}assets/brand/web/mark-96.webp`} width="42" height="42" alt="" />
            <strong>KairoPont</strong>
          </Link>
          <h1>Fale com a gente</h1>
        </header>
        <div className="legal-body">
          <h2>Suporte e contato</h2>
          <p>Dúvidas sobre o portal, implantação ou privacidade:</p>
          <p><a className="contact-email" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
          <h2>Responsáveis pelo projeto</h2>
          <p><strong>Empresa:</strong> {SITE_COMPANY}<br /><strong>Responsável pelo projeto:</strong> {SITE_OWNER}</p>
          <p>Para assuntos sobre dados e registros de trabalho, entre em contato também com a equipe administrativa da {SITE_COMPANY} pelo canal corporativo de RH.</p>
          <Link className="btn btn-secondary" to="/suporte">Abrir central de ajuda</Link>
        </div>
        <footer className="legal-footer">
          <Link to="/">Voltar ao início</Link>
          <LegalLinks />
        </footer>
      </article>
    </main>
  );
}
