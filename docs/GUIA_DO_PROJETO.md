# KairoPont — guia do projeto

Revisado em 7 de outubro de 2026

**Aplicação:** [https://oc-mateus.github.io/KairoPont/](https://oc-mateus.github.io/KairoPont/)  
**Código-fonte:** [https://github.com/oc-mateus/KairoPont](https://github.com/oc-mateus/KairoPont)

## Resumo executivo

KairoPont é uma aplicação web da Kairo Automações para registrar a jornada dos funcionários, consultar históricos e enviar atestados médicos ou declarações de horas. O frontend é servido pelo GitHub Pages; autenticação, banco de dados e armazenamento de arquivos usam o Supabase.

O site está publicado e o workflow automatizado de build e publicação está ativo. O banco tem o esquema e as políticas das migrações do projeto. Em 7 de outubro de 2026 foi provisionada uma conta administrativa destinada a testes; valide os fluxos apenas com dados fictícios e revise as credenciais antes da operação real.

A aplicação também pode ser instalada como PWA em navegadores compatíveis. No Android, abra o endereço HTTPS no Chrome e use **Instalar aplicativo** (no botão do sistema, quando disponível, ou no menu do navegador). O modo instalado abre em janela própria; recursos que dependem do Supabase ainda precisam de conexão. O Chrome para iOS não oferece o mesmo fluxo de instalação do Android; nesse sistema, use a opção de adicionar à tela inicial oferecida pelo navegador compatível.

**O projeto ainda não está validado para operação real.** O acesso é feito com e-mail corporativo e senha. Contas comuns são criadas somente por convite do administrador; o funcionário define a própria senha pelo link enviado ao e-mail. O CPF permanece como dado de identificação, não como forma de login.

## O que a aplicação oferece

### Para funcionários

- Entrar com e-mail e senha.
- Receber convite do administrador e definir a própria senha.
- Registrar quatro etapas de jornada na ordem: entrada, saída para almoço, retorno do almoço e saída.
- Consultar o próprio histórico e exportá-lo para PDF, Excel (.xlsx) ou Markdown.
- Enviar atestado médico ou declaração de horas e baixar documentos autorizados.
- Atualizar dados básicos do perfil e a foto.
- Consultar períodos aquisitivos; a tela mostra a data de admissão e separa a data de liberação para solicitar da primeira data possível de saída. Antes de completar um ano, informa claramente a inelegibilidade.
- Registrar se pretende vender férias e quantos dias (até 10) dentro do prazo; no pedido de gozo, informar data de saída e data de retorno ao trabalho.
- Enviar a solicitação de gozo para a fila administrativa e acompanhar o envio do pedido; o resultado é comunicado exclusivamente por e-mail.
- Receber exclusivamente por e-mail a decisão de aprovação ou recusa; recusas incluem a justificativa. A tela não revela o resultado da decisão.

### Para administradores

- Consultar indicadores e registros da equipe.
- Gerenciar perfis e status de funcionários.
- Selecionar um funcionário para consultar nome completo, CPF, cargo, registros de ponto e documentos enviados, incluindo data e tipo.
- O menu de administradores mostra Painel Admin, Funcionários e Férias; Meu Perfil permanece na seção Conta. Registrar Ponto, Meu Histórico, Documentos e Minhas Férias não aparecem para administradores, pois ponto e documentos são acessados pela ficha individual e as férias pela gestão administrativa.
- Filtrar os registros individuais por dia, semana, mês ou período personalizado e baixar o resultado em Excel (.xlsx) ou PDF.
- Baixar documentos individuais por links assinados temporários.
- Criar funcionário por convite, informando admissão, cargo e escala semanal; editar admissão/escala dos perfis existentes.
- Configurar cada dia separadamente: dias trabalhados, entrada, saída/retorno do almoço e saída final; um dia pode ser jornada contínua sem intervalo (por exemplo, sábado 08h–12h). A escala completa fica visível na ficha administrativa e em Meu Perfil, e a jornada contínua tem só marcações de entrada e saída.
- Consultar solicitações de férias, aprovar ou recusar (justificativa obrigatória) e reenviar o e-mail da decisão quando necessário.
- Na ficha do funcionário, consultar a data de admissão, quando o pedido será liberado e a primeira data possível de saída; na fila, revisar saída e retorno solicitados.
- Comparar nas tabelas de ponto as horas registradas, a jornada planejada para cada dia e o saldo diário.

Os relatórios PDF de ponto do funcionário e do administrador exibem no cabeçalho a logo oficial da Kairo e o lockup próprio do KairoPont. Na ficha administrativa, PDF, Excel e tabela diária também comparam a jornada prevista com o total marcado. As planilhas Excel incluem título, período, data de geração, cabeçalho estilizado, filtros e colunas dimensionadas para exibir datas e horários sem cortes. As telas usam navegação adaptada para celular, formulários em coluna e tabelas roláveis ou convertidas em cartões nos breakpoints móveis.

Operações administrativas dependem do papel armazenado no banco. Novos perfis comuns só podem ser convidados pelo administrador; cadastros sem convite são recusados pelo banco.

## Como o sistema funciona

### Componentes

| Componente | Responsabilidade |
| --- | --- |
| React, Vite e React Router | Interface web, navegação e formulários |
| GitHub Pages | Hospedagem estática do frontend |
| GitHub Actions | Build e publicação automática quando há atualização em main |
| Supabase Auth | Contas, confirmação de e-mail e sessões |
| Supabase Postgres | Perfis, registros de ponto, metadados de documentos e auditoria |
| Supabase Storage | Arquivos dos documentos e fotos de perfil |
| Supabase Edge Functions | Convites administrativos e e-mails de decisões de férias |

### Pastas principais

| Caminho | Conteúdo |
| --- | --- |
| src/pages | Telas de login, ponto, histórico, perfil, documentos e administração |
| src/contexts | Estado de autenticação e notificações |
| src/lib | Cliente Supabase e funções de formatação e cálculo |
| src/components | Layout e componentes reutilizados |
| supabase/migrations | Esquema, segurança, buckets e políticas do banco |
| .github/workflows/pages.yml | Automação do GitHub Pages |
| public/assets/brand | Arquivos públicos de identidade visual, incluindo o lockup vetorial kairopont-logo.svg |
| public/manifest.webmanifest e public/sw.js | Manifesto instalável, escopo do app e cache básico da interface |

## Registro de ponto

A interface apresenta a próxima etapa válida e impede cliques repetidos enquanto a solicitação está em andamento. A função SQL registrar_ponto confere se o usuário ativo está registrando o próprio ponto, valida a sequência e usa a data e a hora do servidor Supabase no fuso America/Sao_Paulo.

Cada funcionário pode ter um registro por dia. As colunas guardam entrada, saída para almoço, retorno do almoço e saída final.

## Dados e estrutura

As migrações criam as tabelas principais no esquema public:

| Tabela | Dados armazenados | Proteção aplicada |
| --- | --- | --- |
| funcionarios | Perfil, vínculo com Auth, CPF, cargo, status, papel, admissão e escala semanal | Funcionário consulta o próprio perfil; admin pode consultar a equipe |
| registros_ponto | Data e quatro marcações de horário | Funcionário consulta os próprios registros; admin consulta a equipe |
| documentos | Tipo, nome, caminho no Storage e período informado | Funcionário consulta os próprios metadados; admin consulta os autorizados |
| auditoria | Ação administrativa, alvo e detalhes | Leitura limitada ao perfil admin |
| periodos_aquisitivos_ferias | Períodos aquisitivos/concessivos e intenção de abono de 0–10 dias | Funcionário acessa os próprios períodos; admin consulta todos |
| solicitacoes_ferias | Datas desejadas, situação, justificativa e estado do e-mail | Funcionário acessa as próprias solicitações; admin consulta e decide |
| notificacoes | Avisos de prazo de férias próximos ou vencidos | Funcionário acessa os próprios avisos; decisões não são notificadas internamente |

O CPF é dado pessoal. Não inclua CPFs, nomes de funcionários, documentos ou capturas com dados reais em issues, exemplos públicos, commits ou arquivos de documentação.

A tabela `auditoria` continua no banco e recebe eventos administrativos previstos nas funções SQL, mas a interface não possui uma tela de consulta de auditoria.

## Documentos e armazenamento

O bucket documentos é privado. As políticas do Storage exigem autenticação e restringem o envio à pasta vinculada ao perfil autenticado. A leitura é restrita ao funcionário correspondente ou a um administrador. O app cria links assinados de curta duração para download.

A tela aceita PDF, JPEG, PNG e WebP e informa limite de 10 MB. Na configuração verificada, o bucket não tinha lista de tipos permitidos nem limite próprio definido. Assim, as restrições de tipo e tamanho eram verificadas apenas no frontend e não devem ser tratadas como controles suficientes do servidor.

O arquivo é enviado antes dos metadados do documento. Se a gravação dos metadados falhar após o envio, o código atual pode deixar um arquivo sem referência na tabela; não há compensação automática que remova esse arquivo.

O bucket fotos-funcionarios é público porque a interface usa URLs públicas para avatares. Não armazene documentos ou imagens sensíveis nesse bucket. Os documentos médicos pertencem ao bucket privado documentos.

## Segurança e papéis

- RLS está habilitada nas quatro tabelas da aplicação.
- Políticas do banco limitam funcionários aos próprios dados e deixam operações administrativas condicionadas ao papel admin.
- A RPC admin_update_employee verifica no banco que a sessão pertence a um administrador ativo antes de alterar papel ou status.
- O gatilho de cadastro cria perfis com papel employee. Ele não confia em e-mail ou metadados enviados pelo navegador para conceder admin.
- O gatilho exige convite de uso único emitido pela Edge Function administrativa; cadastro sem convite é rejeitado no banco.
- `invite-employee` aceita apenas administrador ativo e cria convite para o Auth enviar o link de definição de senha.
- `vacation-decision-email` valida o administrador e envia aprovação/recusa pelo Resend; as credenciais ficam apenas nos secrets do Supabase.
- A chave pública do Supabase é necessária no frontend e não substitui as políticas RLS. Chaves service_role, secrets, senhas e tokens não devem ser adicionados ao frontend, ao README ou a variáveis públicas do GitHub.
- Os três avisos do Advisor sobre funções SECURITY DEFINER acessíveis a usuários autenticados refletem funções que a aplicação chama. As funções administrativas e de ponto verificam internamente o papel ou a identidade do usuário; reavalie esses avisos após qualquer mudança nas funções.

## Configuração e execução local

### Requisitos

- Node.js 18 ou superior
- npm
- Acesso ao projeto Supabase KairoPont

### Instalação

1. Instale dependências com npm install.
2. Copie .env.example para .env.
3. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo local .env.
4. Inicie o Vite com npm run dev.
5. Gere o build de produção com npm run build.

O arquivo .env é local e não deve ser enviado ao Git. As duas variáveis VITE_ são incorporadas ao cliente no build; só a chave pública apropriada para cliente pode ser usada nelas.

### Supabase

As migrações devem ser aplicadas nesta ordem:

1. supabase/migrations/20261006000000_initial_schema.sql
2. supabase/migrations/20261006001000_security_hardening.sql
3. supabase/migrations/20261006002000_restrict_internal_trigger.sql
4. supabase/migrations/20261007162427_vacation_requests_employee_schedule.sql
5. supabase/migrations/20261007164037_custom_daily_work_schedules.sql
6. supabase/migrations/20261007171841_vacation_request_return_date.sql

O projeto KairoPont registra as migrações listadas, com os buckets documentos (privado) e fotos-funcionarios (público). Não reaplique nem resete o banco de produção para seguir este guia.

As solicitações guardam separadamente o último dia de férias e a data de retorno ao trabalho. Os registros anteriores foram preservados convertendo o antigo último dia em retorno no dia seguinte; pedidos novos usam saída e retorno explícitos.

A função `vacation-decision-email` requer os secrets `RESEND_API_KEY` e `FERIAS_EMAIL_FROM` (endereço verificado no Resend). Sem eles, a decisão é gravada, mas o envio falha e pode ser tentado novamente na fila administrativa. O envio do convite depende do SMTP configurado no Supabase Auth e da URL permitida `https://oc-mateus.github.io/KairoPont/definir-senha`, onde o funcionário define sua senha.

Para perfis existentes, o administrador precisa informar a data de admissão e a escala semanal em Funcionários, confirmando os dados com o RH; sem esses campos, férias não são calculadas e o comparativo de ponto não fica disponível.

Na escala personalizada, cada dia guarda seus próprios horários; o intervalo de almoço pode ser desativado em um dia específico. A sequência de ponto desse dia passa a ser entrada e saída, e a folha calcula a jornada sem subtrair almoço.

### GitHub Pages

O workflow .github/workflows/pages.yml constrói e publica o site a partir de main. Em Settings → Pages, a fonte precisa permanecer como GitHub Actions. Em Settings → Secrets and variables → Actions → Variables, configure:

- VITE_SUPABASE_URL: endereço público do projeto Supabase.
- VITE_SUPABASE_ANON_KEY: chave anon ou publishable apropriada ao cliente.

A URL pública da aplicação é https://oc-mateus.github.io/KairoPont/. O README do repositório e o campo Homepage do GitHub apontam para esse endereço.

## Pendências para entrada em operação

As verificações abaixo foram feitas em 6 de outubro de 2026. Reconfirme o estado antes de usar a aplicação com funcionários.

1. **Configurar Auth:** definir a URL do site no Supabase Auth como https://oc-mateus.github.io/KairoPont/ e adicionar o retorno exato à lista permitida. A configuração não foi confirmada no painel.
2. **Revisar a administração de teste:** uma conta administrativa de teste foi provisionada em 7 de outubro de 2026. Troque ou remova suas credenciais antes de usar a aplicação com dados reais.
3. **Configurar convites e e-mail:** verificar SMTP/URLs do Supabase Auth e cadastrar `RESEND_API_KEY` e `FERIAS_EMAIL_FROM` como secrets da Edge Function.
4. **Impor validação no Storage:** configurar no bucket privado o limite máximo e os MIME types adequados no servidor, além da validação existente no frontend.
5. **Evitar arquivos órfãos:** se o insert dos metadados falhar, remover o objeto enviado ou disponibilizar um processo administrativo de reconciliação.
6. **Completar dados de vínculo:** conferir data de admissão e escala semanal de cada funcionário com o RH.
7. **Validar sem dados reais:** testar convite, definição de senha, login, isolamento entre usuários fictícios, arquivo descartável, link assinado, comparação de ponto, prazos e e-mails de aprovação/recusa.

## Operação e suporte

- Acompanhe o resultado do workflow Publicar no GitHub Pages em Actions. Uma falha no build impede a publicação da nova versão.
- Confira as migrações, o RLS e a visibilidade dos buckets no Supabase antes de qualquer alteração de banco.
- Faça mudanças no esquema por novas migrações versionadas; não altere manualmente produção sem registrar e revisar a mudança.
- Confirme que os backups e a retenção do plano Supabase atendem às necessidades da empresa; essa configuração não foi auditada neste projeto.
- A exportação Markdown é copiada para a área de transferência para colagem no Notion. Não há Edge Function nem integração automática com o Notion no repositório.

## Repositório e publicação

- Repositório: https://github.com/oc-mateus/KairoPont
- Site: https://oc-mateus.github.io/KairoPont/
- Supabase: projeto KairoPont
- Workflow: .github/workflows/pages.yml
