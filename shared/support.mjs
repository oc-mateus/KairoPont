export const DEFAULT_SUPPORT_EMAIL = 'mcoliveira@kairoautomacoes.com.br';

export function getSupportReplyUrl(ticket) {
  const email = String(ticket?.employee?.email || '').trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  const subject = `Re: KairoPont · Chamado #${ticket.protocol} — ${ticket.subject || ''}`.replace(/[\r\n\u0000]/g, ' ');
  const name = String(ticket.employee?.nome || '').replace(/[\r\n\u0000]/g, ' ').trim();
  const body = `${name ? `Olá, ${name}.` : 'Olá.'}\n\nSobre o chamado #${ticket.protocol}:\n\nProblema relatado:\n${ticket.description || ''}\n\nResposta:\n`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const SUPPORT_CATEGORIES = [
  { id: 'acesso', label: 'Acesso e senha' },
  { id: 'ponto', label: 'Registro de ponto' },
  { id: 'exportacao', label: 'PDF e Excel' },
  { id: 'arquivos', label: 'Envio de arquivos' },
  { id: 'outro', label: 'Outro assunto' },
];

export const SUPPORT_STATUS = {
  aberto: 'Aberto', em_atendimento: 'Em atendimento', respondido: 'Respondido', encerrado: 'Encerrado',
};

// Public, reviewed product instructions. No account or employee data belongs here.
export const SUPPORT_ARTICLES = [
  {
    id: 'recuperar-senha', category: 'acesso', title: 'Esqueci minha senha',
    answer: 'Você pode pedir um link para criar uma nova senha usando o e-mail da sua conta.',
    steps: ['Abra “Esqueci minha senha” na tela de entrada.', 'Informe o e-mail cadastrado e confira a caixa de entrada e o spam.', 'Abra o link no navegador em que deseja usar o KairoPont e defina a nova senha.'],
    link: { to: '/recuperar-senha', label: 'Redefinir minha senha' },
    keywords: ['senha', 'esqueci', 'recuperar', 'redefinir', 'password'],
  },
  {
    id: 'acessar-conta', category: 'acesso', title: 'Não consigo entrar na conta',
    answer: 'O acesso é feito com e-mail e senha. As contas são criadas por convite da administração.',
    steps: ['Confira se o e-mail é o mesmo do convite recebido.', 'Selecione seu vínculo CLT ou PJ conforme o cadastro. Administradores podem usar qualquer opção.', 'Se ainda não recebeu o convite ou a conta está desativada, fale com a equipe administrativa.'],
    link: { to: '/login', label: 'Ir para o acesso' },
    keywords: ['entrar', 'acesso', 'login', 'convite', 'conta'],
  },
  {
    id: 'registrar-ponto', category: 'ponto', title: 'Como registrar entrada e saída',
    answer: 'O horário oficial é gravado pelo servidor. Aguarde a confirmação de cada marcação antes de sair da página.',
    steps: ['Entre na conta e abra “Registrar Ponto”.', 'Use a próxima marcação disponível. PJ registra entrada e saída; CLT segue o intervalo previsto na jornada.', 'Confira a marcação no histórico. Se houver erro ou uma jornada antiga aberta, peça a correção à administração; o suporte automático não altera horários.'],
    link: { to: '/ponto', label: 'Abrir registro de ponto' },
    keywords: ['ponto', 'entrada', 'saida', 'marcacao', 'intervalo', 'jornada'],
  },
  {
    id: 'exportar-historico', category: 'exportacao', title: 'Baixar minha folha em PDF ou Excel',
    answer: 'A folha de ponto pode ser exportada no histórico da sua própria conta.',
    steps: ['Abra “Meu Histórico” e escolha o período.', 'Use a opção de exportação em PDF ou Excel.', 'Se o download não aparecer, confira os downloads e as permissões do navegador. Para divergências nos valores ou horários, solicite revisão à equipe.'],
    link: { to: '/historico', label: 'Abrir meu histórico' },
    keywords: ['exportar', 'exportacao', 'pdf', 'excel', 'planilha', 'baixar', 'folha', 'download'],
  },
  {
    id: 'enviar-documento', category: 'arquivos', title: 'Meu documento não foi enviado',
    answer: 'Funcionários CLT podem enviar atestados e declarações de horas. O limite por arquivo é de 10 MB.',
    steps: ['Use PDF, JPEG, PNG ou WebP, com até 10 MB.', 'Abra “Documentos”, selecione o tipo e o período, quando necessário.', 'Aguarde a confirmação e confira se o arquivo aparece na lista. Contas PJ não têm essa seção.'],
    link: { to: '/documentos', label: 'Abrir documentos' },
    keywords: ['documento', 'arquivo', 'upload', 'atestado', 'declaracao', 'anexo', 'enviar'],
  },
  {
    id: 'foto-perfil', category: 'arquivos', title: 'Trocar minha foto de perfil',
    answer: 'A foto de perfil deve ser JPEG, PNG ou WebP, com até 5 MB.',
    steps: ['Abra “Meu Perfil” e selecione a opção de foto.', 'Escolha uma imagem nos formatos e tamanho permitidos.', 'Aguarde a confirmação. Fotos de perfil são públicas: use apenas uma imagem que possa ser exibida.'],
    link: { to: '/perfil', label: 'Abrir meu perfil' },
    keywords: ['foto', 'avatar', 'imagem', 'perfil'],
  },
];

export function normalizeSupportText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function requiresHumanSupport(question, category) {
  const value = normalizeSupportText(question);
  return category === 'outro' || /\b(corrigir|correcao|ajustar|alterar horario|ponto errado|ferias|salario|pagamento|lgpd|excluir (meus )?dados|dados pessoais|cpf|diagnostico|senha (e|eh)|token|api.key)\b/.test(value)
    || /(?:minha\s+)?senha\s*[:=]/.test(value)
    || /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/.test(value)
    || /\b(?:eyJ[A-Za-z0-9_-]+\.|sk-[A-Za-z0-9_-]{12,})/.test(question);
}

export function findSupportArticle(question, category) {
  const value = normalizeSupportText(question);
  const best = SUPPORT_ARTICLES.filter((article) => article.category === category)
    .map((article) => ({ article, score: article.keywords.reduce((total, word) => total + Number(value.includes(word)), 0) }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.score > 0 ? best.article : null;
}

export function supportHandoff(mode = 'guide') {
  return { mode, needs_human: true, article: null, answer: 'Este assunto precisa da equipe da Kairo. Você pode abrir um chamado para receber uma análise. O atendimento automático não altera contas, horários, férias ou dados pessoais.' };
}

export function redactSupportText(value) {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-mail removido]')
    .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, '[documento removido]')
    .replace(/(?:\+?55\s*)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/g, '[telefone removido]');
}
