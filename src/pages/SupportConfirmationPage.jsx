import { Link, useLocation } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';

export default function SupportConfirmationPage() {
  const { state } = useLocation();
  const protocol = state?.supportProtocol;
  const confirmed = Number.isSafeInteger(Number(protocol)) && Number(protocol) > 0;
  return <main className="public-state-page"><h1>{confirmed ? 'Pedido registrado' : 'Confirmação indisponível'}</h1>{confirmed ? <><p className="support-confirmation-protocol">Protocolo #{protocol}</p><p>Obrigado. Seu pedido foi registrado para análise da equipe.</p></> : <p>Não há um envio confirmado nesta página. Volte à central para enviar sua dúvida.</p>}<div className="public-state-actions"><Link className="btn btn-primary" to="/suporte">Voltar à ajuda</Link><Link className="btn btn-secondary" to="/">Início</Link></div><LegalLinks /></main>;
}
