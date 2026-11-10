# Segurança do KairoPont

Verificado em 8 de novembro de 2026 no projeto Supabase KairoPont. A migração `20261108043421_restrict_api_grants_and_limit_email_abuse.sql` foi aplicada, e as funções `invite-employee` (versão 14) e `vacation-decision-email` (versão 3) foram publicadas com validação de JWT habilitada.

## Resultado das quatro verificações

| Área | Situação e proteção |
| --- | --- |
| Limite de requisições | Convites e e-mails de férias usam contadores atômicos no PostgreSQL, compartilhados entre todos os processos. A chamada ao provedor só ocorre após autenticação, autorização e liberação da cota. |
| Mass assignment | O banco permite editar somente `nome`, `cargo` e `foto_url` no perfil e `lida_em` nas notificações. Papel, status, identidade e vínculo usam rotinas administrativas com validação no servidor. Novos usuários recebem o papel `employee`, independentemente de seus metadados. |
| Webhooks | O projeto não possui webhook de pagamento nem integração de cobrança. O serviço de e-mail de férias exige um administrador ativo e consulta a decisão gravada no banco. Uma decisão com envio já registrado retorna sem reenviar. |
| Banco aberto | As nove tabelas de negócio têm RLS. Acesso anônimo foi revogado, convites são exclusivos do servidor e os contadores ficam no schema privado. Documentos são privados; avatares continuam públicos conforme o desenho atual. |

O ambiente publicado não faz chamadas a modelos de IA. Os serviços externos sujeitos às cotas publicadas são os convites do Supabase Auth e os e-mails do Resend. O [suporte com IA](SUPORTE.md) está preparado apenas no projeto local, com ativação desabilitada e sem publicação.

## Cotas dos serviços

| Serviço | Por administrador | Total do projeto |
| --- | --- | --- |
| Convite de funcionário | 5/minuto, 30/hora, 100/dia | 60/hora, 200/dia |
| E-mail de decisão de férias | 10/minuto, 60/hora, 200/dia | 200/hora, 500/dia |

As janelas começam na primeira chamada e reiniciam após o prazo. Solicitações inválidas de administradores também consomem a cota; chamadas sem autorização são bloqueadas antes dela. Ao atingir o limite, a função devolve HTTP 429, `Retry-After` e o tempo de espera em segundos. Se o banco não puder validar a cota, a função devolve 503 e bloqueia a chamada ao provedor. Os contadores são reutilizados por janela, mantendo um número fixo de linhas por administrador e serviço.

Essas cotas protegem os dois serviços de e-mail. Login e recuperação de senha seguem os limites próprios do Supabase Auth; consultas à API de dados e tráfego de arquivos dependem dos controles da plataforma. Configure alertas de uso e orçamento no provedor para acompanhar os custos totais.

## Requisições e arquivos

- Somente POST executa os serviços; OPTIONS atende à verificação do navegador.
- Origens de navegador permitidas: `https://oc-mateus.github.io`, localhost e 127.0.0.1 nas portas 5173 e 4173. Uma nova hospedagem deve ser adicionada a `supabase/functions/_shared/security.mjs` antes de publicar as funções. A autorização continua obrigatória para chamadas sem cabeçalho Origin.
- O corpo deve ser um objeto JSON de até 16 KiB, medidos durante a leitura. Campos desconhecidos são rejeitados, inclusive `role`, `ativo` e `auth_id`. Campos antigos de apresentação de escala são aceitos no convite para compatibilidade e descartados na persistência.
- E-mail, nome, CPF, cargo, data e identificadores têm validação de tipo, formato e comprimento.
- Documentos aceitam PDF, JPEG, PNG e WebP de até 10 MiB; avatares aceitam JPEG, PNG e WebP de até 5 MiB. Os limites valem também para chamadas diretas à API de Storage.
- O registro de documento exige arquivo existente na pasta do próprio funcionário. O cliente não pode escolher o horário de criação, o identificador ou atualizar metadados existentes.
- O envio ao Resend tem prazo de 15 segundos e mantém a chave de idempotência da decisão, inclusive em chamadas simultâneas. O sucesso é registrado no banco para evitar reenvios posteriores.
- Dependências das funções estão fixadas e os arquivos `deno.lock` registram suas integridades.

## Verificações executadas

- `npm test`: 23 testes aprovados, incluindo validação de payload, campos privilegiados, origem, tamanho em bytes e falha da cota.
- `npm run test:edge`: 11 cenários aprovados nos handlers reais, com autenticação e provedores simulados; nenhum e-mail real enviado.
- `npm run check:edge`: tipos das duas funções validados com suas dependências reais.
- `npm run build`: aplicação compilada.
- `npm audit --omit=dev --audit-level=high`: nenhuma vulnerabilidade encontrada nas dependências de produção.
- `supabase/tests/security.sql`: execução no banco em uso com usuários temporários, tentativas de promoção a administrador, alteração de identidade, acesso a colegas, adulteração de notificações, arquivos de terceiros, contas inativas e limites por minuto/hora/projeto. Todos os dados e alterações de cota foram revertidos no fim da transação.
- HTTP nos serviços publicados: origem da aplicação permitida; origem externa bloqueada com 403; chamadas sem sessão ou com somente a chave pública rejeitadas com 401.

Os testes de aplicação, tipos e handlers integram o workflow de publicação. Para repetir os testes SQL, execute o arquivo completo como dono do banco. A preparação requer um administrador ativo existente; as contas temporárias usam o domínio reservado `example.invalid` e nunca recebem sessões de login ou e-mails.

## Pontos de operação ainda existentes

O verificador do Supabase continua indicando proteção contra senhas vazadas desativada. Em 8 de novembro de 2026, o conector confirmou que a organização Kairo está no plano Free. A [proteção nativa exige o plano Pro ou superior](https://supabase.com/docs/guides/auth/password-security), cujo [preço inicial é US$ 25 por mês](https://supabase.com/pricing). A ativação foi adiada a pedido do usuário; o plano Free foi mantido e nenhuma mudança de plano ou cobrança foi realizada.

Os avisos sobre funções `SECURITY DEFINER` autenticadas correspondem às rotinas que precisam executar operações controladas; as verificações de administrador ativo ou de propriedade foram revisadas e testadas. As tabelas de convites e contadores ficam sem políticas de cliente de propósito, para negar acesso.

MFA, recuperação de backups, revisão da conta administrativa de teste e preparação de implantações para clientes continuam no checklist de [Comercialização e operação](COMERCIALIZACAO.md).

## Ao adicionar pagamentos ou IA

Uma nova integração de IA deve executar no servidor, usar cotas por usuário e projeto e ter limites de uso e orçamento no provedor. A chave privilegiada permanece fora do frontend.

Antes de disponibilizar um webhook de pagamento, valide a assinatura sobre o corpo original com a biblioteca oficial do provedor, registre o identificador de evento de forma única para impedir repetição e confira pedido, conta, valor e moeda no servidor. A liberação do produto deve ocorrer em uma transação idempotente após essas verificações.

Referências: [RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [permissões por coluna](https://supabase.com/docs/guides/database/postgres/column-level-security), [restrições de buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets).
