# Checklist de lançamento do KairoPont

Revisão de 10 de novembro de 2026. O escopo desta etapa é o site e a preparação dos registros. A adequação trabalhista foi adiada por decisão do responsável. Nenhuma revisão técnica elimina todos os riscos legais ou operacionais.

| Item | Entrega / situação |
| --- | --- |
| 01. Página 404 | Tela própria, links de retorno e HTML 404 sem indexação. |
| 02. Título por página | Títulos específicos em todas as rotas conhecidas, sem nomes de funcionários. |
| 03. Descrição por página | Descrições próprias; páginas públicas recebem metadados já no HTML publicado. |
| 04. CTA inicial | Acesso ao portal no cabeçalho e no primeiro bloco. |
| 05. Favicons | ICO 16/32, PNG 16/32, Apple 180, PWA 192/512 e ícone maskable. |
| 06. robots.txt | Gerado no build; a limitação do subdiretório do GitHub Pages está descrita abaixo. |
| 07. sitemap.xml | Apenas páginas públicas; exclui login, conta, registros, administração e confirmação. |
| 08. Imagem social | PNG 1200×630 com a marca, descrição e metadados Open Graph. |
| 09. Texto alternativo | Imagens informativas têm alt; marcas decorativas com texto adjacente usam alt vazio. |
| 10. Celular | Conferência em 320, 390, 768 e 1440 px, com controles e links acessíveis. |
| 11. CTA fixo móvel | Acesso ao portal na página inicial, com espaço reservado e área segura do celular. |
| 12. Carregamento | Indicadores acessíveis, páginas carregadas sob demanda e recuperação de falhas de renderização. |
| 13. Erros de formulário | Campos obrigatórios, mensagens de falha, preservação da dúvida e prevenção de duplicidade. |
| 14. Confirmação | Página de confirmação após resposta válida do suporte; acesso direto não simula um envio. |
| 15. Privacidade | Política atualizada, responsável e contato identificados; inclui localização e armazenamento. |
| 16. Termos | Acesso, responsabilidades e condições; não afirma adequação integral a REP-P. |
| 17. Banner de cookies | Não aplicável nesta configuração: apenas sessão/preferências necessárias e nenhuma categoria opcional de rastreamento. Página de transparência disponível. |
| 18. Analytics | Não ativado, conforme escolha expressa de Mateus. Nenhum rastreador foi instalado. |
| 19. Contato real | mcoliveira@kairoautomacoes.com.br e responsável Mateus de Campos Oliveira, pessoa física. |
| 20. Imagens comprimidas | Ativos web próprios, fontes locais e exclusão de originais pesados somente na publicação. Originais permanecem no repositório. |

## Medidas de tamanho

Os originais de marca somavam 96.945.334 bytes. A pasta de marca servida passou a 372.963 bytes, redução de 99,62% desse conjunto. O build completo medido tem aproximadamente 3,26 MB, incluindo bibliotecas de exportação carregadas apenas quando necessárias. O ícone usado no cabeçalho passou de 36.731 bytes para 5.766 bytes. Isso não representa uma medição de Core Web Vitals de todos os usuários.

As fontes agora são entregues pelo próprio site. Não há requisição de fontes ao Google durante a navegação normal. Avisos das licenças de terceiros são distribuídos em `licenses/third-party-notices.txt`.

## Hospedagem e indexação

O endereço atual é `https://oc-mateus.github.io/KairoPont/`. As páginas públicas têm HTML próprio com metadados; rotas autenticadas recebem `noindex,nofollow`. Esses metadados não substituem autenticação nem RLS.

Robôs consultam `robots.txt` na raiz do domínio. O arquivo em `/KairoPont/robots.txt` não controla sozinho toda a origem `oc-mateus.github.io`; a publicação em um domínio próprio deverá disponibilizar o arquivo na raiz. O sitemap pode ser informado diretamente às ferramentas de busca. Não alteramos outros projetos da conta nem contratamos domínio.

## Pendências externas

- Registros de marca e software: materiais preparados, sem protocolo ou certificado do INPI. Exigem identificação, conferência, assinatura e pagamento nos sistemas oficiais. Ver [preparação para o INPI](REGISTROS_INPI.md).
- A identidade jurídica e o contrato de cada implantação, as bases/prazos concretos de tratamento e as responsabilidades entre prestador e empregador precisam ser definidos antes de comercializar.
- As pendências de segurança e operação do relatório anterior, como MFA, CAPTCHA e recuperação de backups, não são resolvidas por esta lista de marketing. Ver [teste de segurança](PENTEST_2026-11-10.md).
- A adequação REP-P/controle oficial de jornada continua pendente por decisão do responsável. Os dados atuais não foram apagados nem migrados para outro sistema.

Referência sobre cookies: [guia oficial da ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais).
