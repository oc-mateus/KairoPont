import { Link } from 'react-router-dom';

export default function LegalLinks({ className = '' }) {
  return (
    <nav className={`legal-links ${className}`} aria-label="Informações legais">
      <Link to="/privacidade">Privacidade</Link>
      <span aria-hidden="true">·</span>
      <Link to="/termos">Termos de uso</Link>
    </nav>
  );
}
