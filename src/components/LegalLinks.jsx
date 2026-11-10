import { Link } from 'react-router-dom';

export default function LegalLinks({ className = '' }) {
  return (
    <nav className={`legal-links ${className}`} aria-label="Ajuda e informações legais">
      <Link to="/suporte">Ajuda e suporte</Link>
      <span aria-hidden="true">·</span>
      <Link to="/privacidade">Privacidade</Link>
      <span aria-hidden="true">·</span>
      <Link to="/termos">Termos de uso</Link>
      <span aria-hidden="true">·</span>
      <Link to="/cookies">Cookies</Link>
      <span aria-hidden="true">·</span>
      <Link to="/contato">Contato</Link>
      <span aria-hidden="true">·</span>
      <a href={`${import.meta.env.BASE_URL}licenses/third-party-notices.txt`}>Licenças</a>
    </nav>
  );
}
