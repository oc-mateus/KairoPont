export const SITE_NAME = 'KairoPont';
export const SITE_OWNER = 'Mateus de Campos Oliveira';
export const SITE_COMPANY = 'Kairo Automações';
export const CONTACT_EMAIL = 'mcoliveira@kairoautomacoes.com.br';
export const DEFAULT_SITE_URL = 'https://oc-mateus.github.io/KairoPont/';

export const PAGE_METADATA = {
  '/': { title: 'KairoPont — Registro e gestão de jornada', description: 'Registre entradas e saídas, consulte sua jornada e organize rotinas administrativas com o KairoPont.', index: true },
  '/suporte': { title: 'Ajuda e suporte | KairoPont', description: 'Encontre orientações sobre acesso, ponto, relatórios e documentos. Entre em contato com o suporte do KairoPont.', index: true },
  '/contato': { title: 'Contato | KairoPont', description: 'Fale com o responsável pelo KairoPont para dúvidas sobre o portal, implantação ou privacidade.', index: true },
  '/privacidade': { title: 'Política de privacidade | KairoPont', description: 'Entenda o uso de dados pessoais, localização, documentos e os canais para exercer seus direitos no KairoPont.', index: true },
  '/termos': { title: 'Termos de uso | KairoPont', description: 'Condições de acesso e uso do KairoPont, responsabilidades e limites do serviço.', index: true },
  '/cookies': { title: 'Armazenamento e cookies | KairoPont', description: 'Conheça o armazenamento necessário ao portal. O KairoPont não usa analytics nem cookies publicitários.', index: true },
  '/login': { title: 'Entrar | KairoPont', description: 'Acesse sua conta individual para registrar e consultar a jornada.' },
  '/licencas': { title: 'Licenças de terceiros | KairoPont', description: 'Consulte as bibliotecas, fontes e licenças de terceiros usadas pelo KairoPont.', index: true },
  '/recuperar-senha': { title: 'Redefinir senha | KairoPont', description: 'Solicite um link para redefinir a senha da sua conta.' },
  '/definir-senha': { title: 'Definir nova senha | KairoPont', description: 'Defina uma nova senha para acessar o portal.' },
  '/suporte/confirmacao': { title: 'Pedido registrado | KairoPont', description: 'Confirmação de abertura de um pedido de suporte.' },
  '/ponto': { title: 'Registrar ponto | KairoPont', description: 'Registre a entrada e a saída da sua jornada.' },
  '/historico': { title: 'Histórico de ponto | KairoPont', description: 'Consulte e exporte seus registros de jornada.' },
  '/documentos': { title: 'Meus documentos | KairoPont', description: 'Envie e consulte documentos da sua conta.' },
  '/perfil': { title: 'Meu perfil | KairoPont', description: 'Consulte e atualize os dados do seu perfil.' },
  '/ferias': { title: 'Férias | KairoPont', description: 'Acompanhe períodos e solicitações de férias.' },
  '/admin': { title: 'Painel administrativo | KairoPont', description: 'Indicadores administrativos de frequência e jornada.' },
  '/admin/funcionarios': { title: 'Funcionários | KairoPont', description: 'Consulte cadastros e registros dos funcionários.' },
  '/admin/calendario': { title: 'Calendário | KairoPont', description: 'Gerencie os feriados do calendário da empresa.' },
  '/admin/auditoria': { title: 'Auditoria | KairoPont', description: 'Consulte o histórico de alterações administrativas.' },
  '/admin/suporte': { title: 'Atendimentos | KairoPont', description: 'Consulte e acompanhe chamados de suporte autorizados.' },
};

export function getPageMetadata(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  return { path, index: false, ...PAGE_METADATA[path], ...(PAGE_METADATA[path] ? {} : { title: 'Página não encontrada | KairoPont', description: 'A página solicitada não está disponível. Volte ao início ou encontre ajuda no KairoPont.', notFound: true }) };
}

export function siteUrl(path = '', base = DEFAULT_SITE_URL) {
  return new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`).href;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function metadataHtml(path, base = DEFAULT_SITE_URL) {
  const meta = getPageMetadata(path);
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<meta name="robots" content="${meta.index ? 'index,follow' : 'noindex,nofollow'}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="pt_BR">',
    '<meta property="og:site_name" content="KairoPont">',
    `<meta property="og:image" content="${escapeHtml(siteUrl('assets/brand/web/og-kairopont.png', base))}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="KairoPont — registro e gestão de jornada">',
    '<meta name="twitter:card" content="summary_large_image">',
  ];
  if (meta.index) tags.push(`<link rel="canonical" href="${escapeHtml(siteUrl(meta.path, base))}">`, `<meta property="og:url" content="${escapeHtml(siteUrl(meta.path, base))}">`);
  return tags.join('\n    ');
}
