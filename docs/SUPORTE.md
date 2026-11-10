# Suporte do KairoPont

Implementação de 8 de novembro de 2026, atualizada e com publicação autorizada em 10 de novembro de 2026. A estrutura de chamados foi aplicada ao Supabase e a função `support-assistant` foi publicada com JWT obrigatório. O endereço de contato e destinatário dos avisos é **mcoliveira@kairoautomacoes.com.br**, informado pela Kairo. A publicação do frontend pelo GitHub Pages habilita a abertura de chamados. O envio de e-mails depende da chave Resend e de um remetente verificado. A proteção nativa contra senhas vazadas permanece adiada no plano Free.

## Fluxo implementado

1. A rota pública `/suporte` oferece busca, temas e orientações aprovadas, mesmo sem sessão ou acesso a provedores de IA.
2. As orientações por tema continuam disponíveis na própria página, sem chamar um modelo.
3. **Buscar orientação** abre diretamente um chamado para contas ativas: o texto da caixa vira a descrição, e o assunto é gerado a partir do início da mensagem. O mesmo envio prepara o e-mail à equipe; não existe um segundo formulário ou botão para abrir o chamado. Visitantes precisam entrar na conta para que o pedido use nome e e-mail do cadastro. Os handlers de orientação por IA continuam preparados no servidor, mas esse botão não os chama.
4. Correções de jornada, férias, dados pessoais, credenciais e perguntas fora do escopo são encaminhadas à equipe. O assistente não altera registros, não lê dados de colegas, não aprova férias e não executa ações administrativas.
5. O bloco “Precisa da equipe?” e a seção “Meus chamados” foram retirados de `/suporte`. A consulta administrativa permanece na página existente **Atendimentos** (`/admin/suporte`), sem uma nova página de listagem. Uma nova tentativa da mesma solicitação usa o mesmo identificador e retorna o mesmo protocolo, sem duplicar o chamado; falhas preservam o texto digitado.
6. Somente contas ativas com **Acesso ao suporte** usam `/admin/suporte` para filtrar a fila, ler e alterar o status. Esse acesso é independente do perfil de administrador. Um administrador pode conceder ou retirar o acesso em **Funcionários → Editar cadastro**; as contas começam sem esse acesso. O nome e o e-mail cadastrados do solicitante aparecem na lista e nos detalhes, por uma consulta que não libera os demais dados do cadastro de colegas. A resposta é **somente por e-mail**: **Responder por e-mail** abre o aplicativo com destinatário, protocolo, assunto e problema completo preenchidos no rascunho. O portal não recebe nem exibe essa resposta. Após o envio, o operador pode atualizar o status manualmente; essa alteração é auditada, e apenas abrir o rascunho não altera o chamado.
7. Quando remetente e provedor forem configurados, o chamado é enviado para **mcoliveira@kairoautomacoes.com.br** pelo Resend, com protocolo, categoria, nome, e-mail do solicitante e **o texto completo digitado na caixa**. O campo `reply_to` aponta para o e-mail do solicitante, permitindo responder diretamente pela caixa de suporte. Nome e e-mail são consultados no cadastro vinculado ao chamado, sem confiar em campos enviados pelo navegador. Falhas de e-mail preservam o chamado e permitem uma nova tentativa controlada pelo suporte. A confirmação ao solicitante informa somente o registro do pedido, sem afirmar entrega de e-mail.

A resposta automática abrange os temas aprovados pelo usuário: acesso e senha, registro de ponto, PDF/Excel e envio de arquivos. A base distingue uso do produto de alterações que exigem a administração. A informação “24h” refere-se à consulta das orientações e à abertura de chamados quando habilitada; a resposta humana segue a disponibilidade da equipe.

## Configuração pendente, sem valores inventados

No frontend, `.env.example` contém:

| Variável | Uso | Estado inicial |
| --- | --- | --- |
| `VITE_SUPPORT_ENABLED` | Habilita as operações de atendimento e a fila | `false` |
| `VITE_SUPPORT_EMAIL` | Endereço público para o link de contato | `mcoliveira@kairoautomacoes.com.br` |

No servidor, `supabase/functions/support-assistant/.env.example` contém:

| Variável | Uso | Estado inicial |
| --- | --- | --- |
| `SUPPORT_ENABLED` | Permite executar a função de suporte | Ativo na publicação; `false` desativa |
| `SUPPORT_AI_ENABLED` | Permite chamar a API de IA | `false` |
| `OPENAI_API_KEY` | Chave de API do servidor | Vazio |
| `SUPPORT_AI_MODEL` | Modelo que suporte Structured Outputs na Responses API | Vazio |
| `SUPPORT_EMAIL_ENABLED` | Permite enviar avisos à equipe | Ativo na publicação; `false` desativa |
| `SUPPORT_EMAIL` | Caixa de suporte que receberá os avisos | `mcoliveira@kairoautomacoes.com.br` |
| `SUPPORT_EMAIL_FROM` | Endereço simples de remetente verificado no Resend | Usa `FERIAS_EMAIL_FROM` quando não informado |
| `RESEND_API_KEY` | Chave de envio do servidor | Vazio |

As variáveis do servidor pertencem aos secrets da função ou ao ambiente local seguro. Elas não devem ser colocadas em variáveis `VITE_*`, no frontend ou no Git. Sem modelo, chave ou ativação da IA, o servidor responde com as orientações revisadas. Sem e-mail, os chamados continuam na fila do portal.

O envio de avisos à caixa está preparado. A equipe pode responder manualmente pelo próprio aplicativo de e-mail, usando o contato do solicitante. Essas mensagens externas não são copiadas automaticamente para o portal. Não há conexão para leitura da caixa, webhook de recebimento ou resposta automática a e-mails ativados nesta etapa.

Diagnóstico confirmado em 10 de novembro de 2026: o ambiente publicado não tinha `RESEND_API_KEY` nem remetente (`SUPPORT_EMAIL_FROM` ou `FERIAS_EMAIL_FROM`) configurados. O chamado #1 foi salvo sem tentativa de envio. O registro de diagnóstico informa apenas a presença dessas configurações, sem incluir chaves, endereços ou conteúdo dos chamados. O rascunho de resposta no aplicativo de e-mail funciona independentemente dessa integração de avisos.

## Controles de segurança e custo

- RLS permite que uma conta ativa consulte apenas os próprios chamados. Somente contas ativas com `suporte=true` consultam a fila e respondem; ser administrador não concede esse acesso automaticamente.
- `list_support_tickets` devolve apenas os dados do chamado e nome/e-mail do solicitante. Uma conta de suporte sem perfil admin continua sem acesso aos demais cadastros, CPFs, documentos ou ferramentas administrativas.
- O navegador não recebe permissão de INSERT, UPDATE ou DELETE na tabela. Abertura e resposta usam rotinas com validação de identidade, campos e limites.
- Somente o suporte altera o status; as respostas são enviadas pelo aplicativo de e-mail do operador. A função antiga de resposta dentro do portal não é executável por clientes. A IA não tem ferramentas, consultas ao banco ou permissões de alteração.
- Perguntas exigem sessão ativa no servidor. Visitantes continuam com a ajuda local; não existe endpoint público para consumo de IA.
- Perguntas: 5 por minuto e 30 por dia por conta; 200 por dia no projeto.
- Chamados: 3 por hora e 5 por dia por conta; 100 por dia no projeto.
- Avisos de e-mail: 3 por minuto e 10 por dia por conta; 100 por dia no projeto. O envio ainda depende de uma reserva persistente por chamado.
- Os contadores são atômicos e persistentes, compartilhados entre instâncias. Falha na consulta de cota bloqueia a chamada ao provedor.
- A IA recebe uma pergunta de até 1.500 caracteres e os artigos públicos da categoria escolhida. Padrões comuns de dados de contato são removidos. Assuntos sensíveis identificados são encaminhados antes da chamada.
- A classificação usa um schema fechado e no máximo 256 tokens de saída, com prazo de 12 segundos e `store: false`. A aplicação não armazena o histórico de perguntas ao assistente. `store: false` não equivale a uma garantia de retenção zero pelo provedor.
- Chamados limitam assunto a 120 caracteres, descrição a 3.000 e resposta humana a 4.000. Nenhum anexo é aceito no suporte.
- Avisos ao Resend usam idempotência por chamado, reserva de envio e prazo de 15 segundos. Depois de enviado não há reenvio; tentativas incertas com mais de 23 horas exigem revisão para respeitar a janela de idempotência do provedor. Há no máximo cinco tentativas por chamado.
- Nunca se presume que a indisponibilidade de um provedor apagou o chamado. O protocolo continua no portal.

As cotas limitam uso, não definem um valor fixo em dinheiro. O custo depende do modelo e das condições dos provedores escolhidos; essas integrações continuam desativadas.

## Arquivos principais

- `shared/support.mjs`: categorias, orientações públicas, busca e encaminhamento.
- `src/pages/SupportPage.jsx`: ajuda e atendimento do solicitante.
- `src/pages/admin/AdminSupport.jsx`: fila e resposta da equipe.
- `src/components/support/`: formulário e lista de chamados.
- `src/hooks/useSupportTickets.js`: carregamento, filtros, paginação e descarte de respostas antigas.
- `supabase/functions/support-assistant/`: função de atendimento.
- `supabase/functions/_shared/support-answer.mjs`: classificação por IA com resposta canônica e fallback.
- `supabase/functions/_shared/support-email.mjs`: aviso com reserva e idempotência.
- `supabase/migrations/20261108044641_support_center_and_private_ticket_queue.sql`: tabelas, RLS, rotinas, auditoria e cotas. Requer a migração anterior de segurança que cria `private.edge_rate_limits`.

## Validação local

- `npm test`: inclui testes de orientação, privacidade, falha de provedor e PostgreSQL local em memória com PGlite. A migração de suporte real é executada nesse banco local; os testes verificam RLS entre usuários, conta inativa, adulteração de status, idempotência, auditoria, cotas e reserva de e-mail.
- `npm run test:edge`: cobre os handlers com autenticação e provedores simulados. A execução não permite acesso à rede.
- `npm run check:edge`: verifica tipos com as dependências reais das três funções.
- `npm run build`: valida a compilação com o suporte desligado; a compilação também foi verificada com `VITE_SUPPORT_ENABLED=true` para validar o código dos formulários e da fila.
- Verificação de navegador: envio direto por “Buscar orientação”, sessão obrigatória, quatro combinações de perfil admin/funcionário com e sem suporte, acesso ao menu/rota, concessão independente de suporte, rascunho de e-mail com o problema completo, atualização manual do status e espaçamento entre caixa de texto e botão nos dois temas. Todas as requisições ao Supabase foram interceptadas com dados fictícios, sem envio real de e-mails. As larguras 320, 390, 768 e 1440 foram verificadas, com capturas em `output/playwright/`.

## Publicação futura

A publicação foi autorizada em 10 de novembro de 2026. O workflow de GitHub Pages compila com `VITE_SUPPORT_ENABLED=true`; ele não aplica migrações nem publica funções. A função usa o remetente específico de suporte ou, se ausente, o remetente de férias já configurado. Sem uma chave de envio e um remetente válidos, o chamado permanece salvo e a tela informa que o envio por e-mail não foi confirmado. IA permanece desligada até uma ativação específica.

Na distribuição da função, incluir `shared/support.mjs` e as dependências relativas em `supabase/functions/_shared/`, além do `deno.json` e do `deno.lock`. Os exemplos de ambiente local mantêm as integrações desligadas; o código publicado habilita os chamados e tenta o envio quando há configuração de e-mail, respeitando as cotas existentes.

Referências: [Structured Outputs da OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), [API de envio do Resend](https://resend.com/docs/api-reference/emails/send-email), [PGlite local](https://pglite.dev/docs/).
