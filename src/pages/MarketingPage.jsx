import { Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';
import { CONTACT_EMAIL, SITE_OWNER } from '../../shared/site.mjs';

const features = [
  {
    number: '01',
    title: 'Registro com sequência clara',
    text: 'As marcações seguem o fluxo definido para o vínculo e ficam registradas no servidor.',
  },
  {
    number: '02',
    title: 'Histórico para consultar e exportar',
    text: 'Funcionários consultam a própria jornada e podem gerar relatórios em PDF e Excel.',
  },
  {
    number: '03',
    title: 'Administração com trilha de alterações',
    text: 'Administradores acompanham indicadores, gerenciam vínculos e registram justificativas nas correções.',
  },
];

export default function MarketingPage() {
  return (
    <main className="marketing-page">
      <header className="marketing-header">
        <Link className="marketing-brand" to="/" aria-label="KairoPont, início">
          <img src={`${import.meta.env.BASE_URL}assets/brand/web/mark-96.webp`} width="42" height="42" alt="" />
          <span><strong>KairoPont</strong><small>Controle de jornada</small></span>
        </Link>
        <nav aria-label="Navegação principal">
          <a href="#recursos">Recursos</a>
          <Link className="marketing-support-link" to="/suporte">Ajuda</Link>
          <Link className="btn btn-primary marketing-login" to="/login">Acessar portal</Link>
        </nav>
      </header>

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <h1>Registre e acompanhe sua jornada.</h1>
          <p>Entrada, saída, histórico e administração em um portal para celular e computador.</p>
          <div className="marketing-actions">
            <Link className="btn btn-primary" to="/login">Acessar portal <span aria-hidden="true">→</span></Link>
            <a className="marketing-text-link" href="#recursos">Conhecer recursos <span aria-hidden="true">↓</span></a>
          </div>
          <p className="marketing-pilot-note">Implantações piloto avaliadas com a Kairo Automações.</p>
        </div>
        <div className="marketing-preview" aria-label="Resumo ilustrativo da jornada">
          <div className="marketing-preview-top"><span>Exemplo · Hoje</span><span className="marketing-live-dot">Jornada em andamento</span></div>
          <p className="marketing-preview-label">Registro de ponto</p>
          <div className="marketing-timeline">
            <div className="marketing-timeline-row is-complete"><span className="marketing-timeline-marker" /><span><strong>Entrada</strong><small>Marcada pelo funcionário</small></span><b>08:02</b></div>
            <div className="marketing-timeline-row is-next"><span className="marketing-timeline-marker" /><span><strong>Intervalo</strong><small>Conforme a escala cadastrada</small></span><b>12:00</b></div>
            <div className="marketing-timeline-row"><span className="marketing-timeline-marker" /><span><strong>Saída</strong><small>Disponível no momento certo</small></span><b>—</b></div>
          </div>
          <div className="marketing-preview-foot"><span>Histórico atualizado</span><span aria-hidden="true">✓</span></div>
        </div>
      </section>

      <section className="marketing-features" id="recursos">
        <div className="marketing-section-heading">
          <h2>Rotinas conectadas do registro ao acompanhamento.</h2>
        </div>
        <div className="marketing-feature-grid">
          {features.map((feature) => (
            <article className="marketing-feature" key={feature.number}>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-access">
        <div>
          <h2>As informações de cada funcionário são acessadas pela conta autorizada.</h2>
          <p>O sistema usa autenticação, permissões no banco e registro de ações administrativas. A implantação e os parâmetros de jornada devem ser avaliados para cada empresa.</p>
        </div>
        <Link className="btn btn-secondary" to="/login">Entrar no KairoPont <span aria-hidden="true">→</span></Link>
      </section>

      <section className="marketing-contact"><div><h2>Precisa falar com a gente?</h2><p>Suporte, implantação e privacidade.</p></div><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></section>

      <footer className="marketing-footer">
        <span>© {new Date().getFullYear()} {SITE_OWNER} · KairoPont</span>
        <LegalLinks />
      </footer>
      <div className="marketing-mobile-cta"><Link className="btn btn-primary" to="/login">Acessar portal</Link></div>
    </main>
  );
}
