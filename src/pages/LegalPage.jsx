import { Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';

const lastUpdated = '10 de novembro de 2026';

function PrivacyPolicy() {
  return (
    <>
      <p>Esta política explica como o KairoPont usa dados para autenticar usuários e apoiar o registro e a gestão de jornadas da Kairo Automações.</p>

      <h2>Quem administra o tratamento</h2>
      <p>A Kairo Automações administra o KairoPont. Nas informações relacionadas ao vínculo de trabalho, a empresa responsável pelo vínculo define as finalidades e os prazos de guarda. Para dúvidas ou exercício de direitos, procure a equipe administrativa da Kairo Automações pelo canal corporativo usado para assuntos de RH.</p>

      <h2>Dados usados e para quê</h2>
      <ul>
        <li>Dados de conta, como e-mail, senha protegida pelo serviço de autenticação e identificador da conta, para conceder e proteger o acesso.</li>
        <li>Dados profissionais, como nome, CPF, cargo, tipo de vínculo, data de admissão e escala, para identificar a pessoa e administrar o ponto.</li>
        <li>Registros de jornada e alterações administrativas, para consultar, corrigir, auditar e exportar folhas de ponto.</li>
        <li>Pedidos de férias e documentos enviados pelo funcionário, quando esses recursos forem aplicáveis ao vínculo.</li>
        <li>Foto de perfil opcional, para exibição de avatar. O arquivo fica em um bucket público de imagens; não envie imagens sensíveis ou que não queira tornar acessíveis publicamente.</li>
        <li>Preferências básicas do aplicativo, como tema e sessão de acesso, guardadas no navegador para manter o funcionamento escolhido.</li>
        <li>Dúvidas e chamados de suporte, quando o atendimento estiver habilitado, para orientar o uso do portal e acompanhar as respostas da equipe. Evite incluir senhas, CPF e informações médicas nas mensagens.</li>
      </ul>

      <h2>Finalidades e bases de tratamento</h2>
      <p>Os dados são usados para autenticação, registro e gestão de jornada, administração de férias e documentos, segurança e auditoria. O tratamento de dados de trabalho não depende de uma caixa genérica de consentimento: a empresa responsável deve usar a base legal adequada à relação e às obrigações aplicáveis. O uso opcional de foto de perfil pode ser interrompido removendo ou substituindo a imagem pelo canal administrativo.</p>

      <h2>Serviços que apoiam o aplicativo</h2>
      <p>O KairoPont usa Supabase para autenticação, banco de dados e armazenamento; o projeto de banco está hospedado na região US East (N. Virginia). E-mails de acesso, recuperação de senha e notificações podem ser enviados por Supabase e Resend. A fonte tipográfica DM Sans é carregada do Google Fonts. O aplicativo também é servido pelo GitHub Pages. Esses serviços recebem os dados técnicos necessários às respectivas solicitações; não usamos Google Analytics, pixels de publicidade ou scripts de rastreamento no código do aplicativo.</p>

      <h2>Compartilhamento e segurança</h2>
      <p>Quando a ajuda por IA estiver habilitada, a dúvida enviada pode ser processada pela OpenAI junto das orientações públicas do produto. A aplicação remove padrões comuns de e-mail, telefone e CPF do texto enviado ao modelo e encaminha temas sensíveis para atendimento humano. Registros de ponto, documentos e dados cadastrais não são consultados pela IA. Os chamados ficam acessíveis somente às contas autorizadas. Ao enviar um pedido de suporte, a mensagem, o nome e o e-mail de cadastro podem ser enviados à caixa de suporte da Kairo, com o protocolo e um link para o portal, para permitir a resposta por e-mail.</p>
      <p>Os registros de funcionários são limitados por regras de acesso no banco: funcionários consultam os próprios dados e administradores autorizados gerenciam os registros necessários à operação. Documentos enviados ficam em armazenamento privado; fotos de perfil são públicas, como explicado acima. As chaves privilegiadas do banco não são usadas no navegador. O sistema aplica controles técnicos, mas nenhum serviço conectado à internet pode prometer risco zero.</p>

      <h2>Cookies e armazenamento no navegador</h2>
      <p>O aplicativo não usa cookies de publicidade ou de analytics. Ele armazena localmente a sessão necessária para manter o usuário conectado e preferências de interface. Esses itens são necessários ao funcionamento da conta; não há banner de consentimento para cookies de rastreamento porque esses cookies não são usados.</p>

      <h2>Guarda, correção e exclusão</h2>
      <p>Os dados são mantidos enquanto a conta e as finalidades de trabalho exigirem. Registros de jornada, documentos e auditorias podem precisar ser conservados por prazos legais, regulatórios ou para exercício regular de direitos. Por isso, encerrar o acesso não significa apagar imediatamente todos os registros. A solicitação de acesso, correção, informação, bloqueio ou eliminação pode ser feita à equipe administrativa pelo canal corporativo de RH; pedidos serão avaliados considerando as obrigações de guarda aplicáveis.</p>

      <h2>Alterações e dúvidas</h2>
      <p>Esta página pode ser atualizada quando o aplicativo ou seus serviços mudarem. Para dúvidas ou solicitações sobre dados pessoais, use o canal corporativo de RH da Kairo Automações.</p>
    </>
  );
}

function TermsOfUse() {
  return (
    <>
      <p>O KairoPont é uma ferramenta interna para usuários convidados registrarem e consultarem informações de jornada e, quando aplicável, férias e documentos.</p>

      <h2>Acesso e responsabilidade</h2>
      <ul>
        <li>Use somente a conta individual fornecida pela administração e mantenha sua senha em sigilo.</li>
        <li>Registre informações de jornada com cuidado e avise a equipe administrativa quando identificar um erro.</li>
        <li>Não tente acessar, alterar ou compartilhar dados de outras pessoas nem contornar as permissões do aplicativo.</li>
        <li>Envie documentos apenas quando forem necessários ao fluxo disponível e evite incluir informações que não foram solicitadas.</li>
      </ul>

      <h2>Registros e suporte</h2>
      <p>O aplicativo oferece consulta e exportação dos dados disponíveis à conta. Correções administrativas podem exigir justificativa e ficam registradas em auditoria. Se uma informação parecer incorreta ou o acesso falhar, procure a equipe administrativa da Kairo Automações pelo canal corporativo de RH.</p>
      <p>A <Link to="/suporte">central de ajuda</Link> reúne orientações de uso. Quando habilitado, o suporte permite abrir e acompanhar chamados pelo portal. A ajuda automática é limitada aos temas publicados; correções de jornada, férias e solicitações sobre dados pessoais dependem da equipe. A disponibilidade da base de ajuda não implica atendimento humano imediato.</p>

      <h2>Disponibilidade e mudanças</h2>
      <p>Recursos podem ser ajustados para manter a operação e a segurança do sistema. O aplicativo depende de conexão com a internet e de serviços externos de hospedagem, autenticação, armazenamento e envio de e-mails.</p>

      <h2>Condições de contratação</h2>
      <p>O acesso comercial ao KairoPont depende de proposta e contrato próprios, que devem apresentar o escopo do serviço, os valores, as condições de pagamento, o suporte e as regras de tratamento e encerramento dos dados antes de qualquer contratação.</p>

      <p className="legal-note">Estes termos descrevem o uso do aplicativo e não substituem políticas internas, acordos de trabalho ou direitos previstos em lei.</p>
    </>
  );
}

export default function LegalPage({ type }) {
  const isPrivacy = type === 'privacy';

  return (
    <main className="legal-page">
      <article className="legal-document">
        <header className="legal-header">
          <div className="legal-brand-lockup">
            <img src={`${import.meta.env.BASE_URL}assets/brand/kairopont-pwa-192.png`} alt="" />
            <span><strong>KairoPont</strong><small>Controle de ponto</small></span>
          </div>
          <p className="legal-updated">Atualizado em {lastUpdated}</p>
          <h1>{isPrivacy ? 'Política de Privacidade' : 'Termos de Uso'}</h1>
          <p className="legal-intro">{isPrivacy ? 'Como o KairoPont trata os dados usados no registro e na gestão de jornada.' : 'Regras de uso do portal interno KairoPont.'}</p>
        </header>

        <div className="legal-body">{isPrivacy ? <PrivacyPolicy /> : <TermsOfUse />}</div>

        <footer className="legal-footer">
          <Link className="legal-back-link" to="/login">Voltar ao acesso</Link>
          <LegalLinks />
        </footer>
      </article>
    </main>
  );
}
