import { Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';

export default function NotFoundPage() {
  return <main className="public-state-page"><img className="public-state-brand" src={`${import.meta.env.BASE_URL}assets/brand/web/mark-96.webp`} width="64" height="64" alt="" /><p className="public-state-code">404</p><h1>Página não encontrada</h1><p>O endereço pode ter mudado. Volte ao início ou encontre ajuda.</p><div className="public-state-actions"><Link className="btn btn-primary" to="/">Voltar ao início</Link><Link className="btn btn-secondary" to="/suporte">Buscar ajuda</Link></div><LegalLinks /></main>;
}
