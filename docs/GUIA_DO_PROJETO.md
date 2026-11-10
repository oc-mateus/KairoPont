# KairoPont — guia do projeto

Revisado em 30 de outubro de 2026

**Aplicação:** [https://oc-mateus.github.io/KairoPont/](https://oc-mateus.github.io/KairoPont/)  
**Código-fonte:** [https://github.com/oc-mateus/KairoPont](https://github.com/oc-mateus/KairoPont)

## Resumo executivo

KairoPont é uma aplicação web da Kairo Automações para registrar a jornada dos funcionários, consultar históricos e enviar atestados médicos ou declarações de horas. O frontend é servido pelo GitHub Pages; autenticação, banco de dados e armazenamento de arquivos usam o Supabase.

O site está publicado e o workflow automatizado de build e publicação está ativo. O banco tem o esquema e as políticas das migrações do projeto. Em 7 de outubro de 2026 foi provisionada uma conta administrativa destinada a testes; valide os fluxos apenas com dados fictícios e revise as credenciais antes da operação real.

A aplicação também pode ser instalada como PWA em navegadores compatíveis. No Android, abra o endereço HTTPS no Chrome e use **Instalar aplicativo** (no botão do sistema, quando disponível, ou no menu do navegador). O modo instalado abre em janela própria; recursos que dependem do Supabase ainda precisam de conexão. O Chrome para iOS não oferece o mesmo fluxo de instalação do Android; nesse sistema, use a opção de adicionar à tela inicial oferecida pelo navegador compatível.

**O projeto ainda não está validado para operação real.** O acesso é feito com e-mail e senha e inclui a seleção do vínculo CLT ou PJ; o sistema confere a opção com o cadastro do funcionário. Administradores continuam podendo entrar sem essa validação. Contas comuns são criadas somente por convite; o funcionário define a própria senha pelo link enviado ao e-mail. O CPF permanece como dado de identificação, não como forma de login.

## O que a aplicação oferece

### Para funcionários

- Entrar com e-mail e senha e escolher CLT ou PJ na tela de login; se o vínculo selecionado não corresponder ao cadastro, a sessão é encerrada e o funcionário recebe uma orientação. Administradores podem entrar pelas duas opções e são encaminhados diretamente ao Painel Admin.
- Receber convite do administrador e definir a própria senha.
- Solicitar redefinição de senha pela tela de login; o link funciona para administradores, CLT e PJ e abre a página de nova senha.
- CLT registra entrada e saída. Nos dias com almoço fixo, o intervalo é descontado pelo horário do turno. Em dias sem almoço fixo, se a jornada passar de seis horas, o sistema exige uma pausa de almoço registrada de pelo menos uma hora.
- PJ registra entrada e saída, sem turno ou almoço programado; o sistema soma o tempo entre as duas marcações para o acompanhamento das horas do período.
- Contas PJ não exibem Documentos nem Minhas Férias e são redirecionadas caso tentem abrir essas rotas diretamente. Na ficha administrativa, a seção de férias também aparece somente para CLT.
- Consultar o próprio histórico e exportá-lo para PDF, Excel (.xlsx) ou Markdown.
- CLT pode enviar atestado médico ou declaração de horas e baixar documentos autorizados. Essas opções não fazem parte da área do funcionário PJ.
- Atualizar dados básicos do perfil e a foto.
- CLT pode consultar períodos aquisitivos; a tela mostra a data de admissão e separa a data de liberação para solicitar da primeira data possível de saída. Antes de completar um ano, informa claramente a inelegibilidade.
- CLT pode registrar se pretende vender férias e quantos dias (até 10) dentro do prazo; no pedido de gozo, informar data de saída e data de retorno ao trabalho.
- A solicitação de gozo de férias CLT vai para a fila administrativa; o resultado é comunicado exclusivamente por e-mail.
- A decisão de aprovação ou recusa de férias CLT chega exclusivamente por e-mail; recusas incluem a justificativa. A tela não revela o resultado da decisão.

### Para administradores

- Consultar indicadores e registros da equipe.
- No painel, acompanhar faltas, atrasos e horas extras de funcionários CLT ativos, sem incluir administradores. Os gráficos gerais aparecem primeiro; abaixo, o administrador seleciona um funcionário CLT para ver os indicadores individuais usando o mesmo filtro de período. O período pode ser o mês atual, um mês/ano escolhido, os últimos seis meses ou o último ano; meses específicos sem registros apresentam uma mensagem de estado vazio.
- Gerenciar perfis e status de funcionários.
- Pesquisar funcionários por nome, CPF ou cargo e ordenar a lista alfabeticamente crescente ou decrescente. A lista e a ficha identificam o vínculo CLT/PJ.
- Selecionar um funcionário para consultar nome completo, CPF, cargo, registros de ponto e documentos enviados, incluindo data e tipo. O botão **Editar cadastro** abre nome, cargo, vínculo CLT/PJ, data de admissão e horários habituais no mesmo formulário, com **Salvar alterações** e **Cancelar**. Somente administradores ativos podem salvar; a atualização é atômica e registra os valores anteriores e novos na auditoria.
- O menu de administradores mostra Painel Admin, Funcionários e Férias; Meu Perfil permanece na seção Conta. Registrar Ponto, Meu Histórico, Documentos e Minhas Férias não aparecem para administradores, pois ponto e documentos são acessados pela ficha individual e as férias pela gestão administrativa.
- Filtrar os registros individuais por dia, semana, mês ou período personalizado e baixar o resultado em Excel (.xlsx) ou PDF.
- Baixar documentos individuais por links assinados temporários.
- Criar funcionário por convite, informando admissão, cargo, vínculo e um ou mais horários habituais CLT. Os presets são 06h–15h (almoço 12h–13h), 08h–17h (almoço 12h–13h) e 14h–22h52 (almoço 18h–19h); não são configurados individualmente por dia. A previsão é de 8h de segunda a sexta, 4h aos sábados sem intervalo fixo e folga aos domingos. O início esperado é arredondado à hora cheia mais próxima; o sistema associa a marcação ao horário habitual mais próximo.
- A opção **Contabilizar atrasos** foi retirada do formulário. A edição do cadastro preserva a preferência já armazenada para o funcionário.
- Consultar solicitações de férias, aprovar ou recusar (justificativa obrigatória) e reenviar o e-mail da decisão quando necessário.
- Na ficha do funcionário, consultar a data de admissão, quando o pedido será liberado e a primeira data possível de saída; na fila, revisar saída e retorno solicitados.
- Corrigir registros de ponto com observação obrigatória; as alterações, o motivo e os valores anteriores ficam registrados na auditoria. Alterações históricas usam fluxo próprio e exigem justificativa.
- Comparar nas tabelas de ponto as horas registradas, a jornada prevista de 8h nos dias úteis (4h no sábado) e o saldo diário.

Os PDFs de ponto baixados pelo administrador na ficha do funcionário e pelo próprio funcionário no Histórico exibem no cabeçalho a logo oficial da Kairo e o lockup próprio do KairoPont. Para CLT, mostram os horários habituais cadastrados, dias por horário, registros sem horário identificado e horas extras do período; também informam a previsão de quatro horas aos sábados sem intervalo. Para PJ, identificam o vínculo e totalizam as horas trabalhadas, sem exibir escala. A folha detalhada identifica o vínculo; CLT exibe o horário habitual mais próximo e o intervalo fixo ou marcado, enquanto PJ exibe entrada, saída e horas computadas. A ficha administrativa, PDF e Excel comparam a jornada prevista com o total marcado. As planilhas Excel incluem título, período, data de geração, cabeçalho estilizado, filtros e colunas dimensionadas para exibir datas e horários sem cortes.

A identidade visual Kairo é mantida em celular, tablet e computador. Os temas claro e escuro usam os mesmos componentes, hierarquia, espaçamentos e interações; somente as cores mudam. O botão de tema fica acessível no cabeçalho sem exigir rolagem horizontal. O menu e os demais controles usam ícones lineares consistentes, sem emojis, e cada página tem um título principal, sem repetir o mesmo título em blocos consecutivos. Em telas móveis, o menu recolhe e as tabelas mantêm leitura sem alargar a página.

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

A interface apresenta a próxima etapa válida e impede cliques repetidos enquanto a solicitação está em andamento. A função SQL `registrar_ponto` confere se o usuário ativo está registrando o próprio ponto, valida a sequência e usa a data e a hora do servidor Supabase no fuso `America/Sao_Paulo`. O fluxo PJ aceita apenas entrada e saída, não atribui horário habitual e calcula o tempo decorrido para o pagamento. Para CLT, os horários de almoço fixos são 12h–13h nos horários de 06h e 08h, e 18h–19h no horário de 14h. Aos sábados, a previsão é de 4h contínuas, sem almoço fixo. Em dias CLT sem almoço fixo, o funcionário pode marcar uma pausa; se a jornada passar de seis horas, é obrigatório registrar saída e retorno do almoço com pelo menos uma hora de intervalo antes da saída final.

Cada funcionário pode ter um registro por dia. O esquema preserva as colunas de almoço para intervalos dinâmicos e compatibilidade; em dias CLT sem almoço fixo, a interface permite registrar a pausa antecipadamente e passa a exigir a marcação antes da saída quando o tempo trabalhado ultrapassa seis horas. O intervalo fixo CLT é calculado conforme o horário habitual mais próximo classificado para aquele registro. Registros PJ não guardam horário habitual.

## Dados e estrutura

As migrações criam as tabelas principais no esquema public:

| Tabela | Dados armazenados | Proteção aplicada |
| --- | --- | --- |
| funcionarios | Perfil, vínculo com Auth, CPF, cargo, status, papel, admissão e lista de horários habituais CLT | Funcionário consulta o próprio perfil; admin pode consultar a equipe |
| registros_ponto | Data de entrada, quatro marcações, horário efetivo e data de saída | Funcionário consulta os próprios registros; admin consulta a equipe |
| documentos | Tipo, nome, caminho no Storage e período informado | Funcionário consulta os próprios metadados; admin consulta os autorizados |
| auditoria | Ação administrativa, alvo e detalhes | Leitura limitada ao perfil admin |
| periodos_aquisitivos_ferias | Períodos aquisitivos/concessivos e intenção de abono de 0–10 dias | Funcionário acessa os próprios períodos; admin consulta todos |
| solicitacoes_ferias | Datas desejadas, situação, justificativa e estado do e-mail | Funcionário acessa as próprias solicitações; admin consulta e decide |
| notificacoes | Avisos de prazo de férias próximos ou vencidos | Funcionário acessa os próprios avisos; decisões não são notificadas internamente |

O CPF é dado pessoal. Não inclua CPFs, nomes de funcionários, documentos ou capturas com dados reais em issues, exemplos públicos, commits ou arquivos de documentação.

A tabela `auditoria` continua no banco e recebe eventos administrativos previstos nas funções SQL, mas a interface não possui uma tela de consulta de auditoria.

## Documentos e armazenamento

O bucket documentos é privado. As políticas do Storage exigem autenticação e restringem o envio à pasta vinculada ao perfil autenticado. A leitura é restrita ao funcionário correspondente ou a um administrador. O app cria links assinados de curta duração para download.

A tela aceita PDF, JPEG, PNG e WebP e informa limite de 10 MB. A configuração do bucket deve impor o mesmo limite e os mesmos tipos no servidor. Para configurar ou conferir o bucket existente, use `npm run configure:document-bucket` com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` fornecidos somente no ambiente local seguro. A chave privilegiada não deve ser gravada em arquivo `.env` usado pelo Vite, adicionada ao frontend ou enviada ao Git.

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
7. supabase/migrations/20261007184409_fixed_work_shifts_and_overnight_punches.sql
8. supabase/migrations/20261007185959_admin_punch_edit_window.sql
9. supabase/migrations/20261007190207_correct_punch_created_at_clock.sql
10. supabase/migrations/20261008234619_turno2_lunch_schedule.sql
11. supabase/migrations/20261009193153_second_shift_ends_at_2252.sql
12. supabase/migrations/20261009203030_saturday_shift_weekly_44h.sql
13. supabase/migrations/20261010174106_pj_punch_and_employee_preferences.sql
14. supabase/migrations/20261010180000_fixed_lunch_and_entry_exit_only.sql
15. supabase/migrations/20261013195909_require_meal_break_after_six_hours.sql
16. supabase/migrations/20261013200129_holiday_calendar_and_admin_punch_deletion.sql
17. supabase/migrations/20261015210151_enforce_active_employee_access_and_sp_dates.sql
18. supabase/migrations/20261017184656_guard_stale_open_punches_and_index_foreign_keys.sql
19. supabase/migrations/20261030174501_work_schedules_and_historical_punches.sql
20. supabase/migrations/20261030175016_admin_punch_change_observations.sql
21. supabase/migrations/20261030175515_classify_records_by_actual_schedule.sql
22. supabase/migrations/20261030175611_saturday_hours_for_44_hour_schedule.sql
23. supabase/migrations/20261030180121_saturday_shifts_four_hours.sql
24. supabase/migrations/20261030181845_habitual_employee_schedules.sql
25. supabase/migrations/20261030182814_standard_eight_hour_workdays.sql

O projeto KairoPont registra as migrações listadas, com os buckets documentos (privado) e fotos-funcionarios (público). Não reaplique nem resete o banco de produção para seguir este guia.

As solicitações guardam separadamente o último dia de férias e a data de retorno ao trabalho. Os registros anteriores foram preservados convertendo o antigo último dia em retorno no dia seguinte; pedidos novos usam saída e retorno explícitos.

A função `vacation-decision-email` requer os secrets `RESEND_API_KEY` e `FERIAS_EMAIL_FROM` (endereço verificado no Resend). Sem eles, a decisão é gravada, mas o envio falha e pode ser tentado novamente na fila administrativa. Convites e redefinições dependem do SMTP do Supabase Auth e da URL permitida `https://oc-mateus.github.io/KairoPont/definir-senha`. O formulário de recuperação envia o retorno para essa rota; se o evento `PASSWORD_RECOVERY` chega pelo endereço padrão do Site URL, o app também encaminha a sessão para a página de nova senha.

Para perfis CLT existentes, o administrador precisa informar a data de admissão e confirmar com o RH a lista de horários habituais em Funcionários; sem esses campos, férias não são calculadas e o comparativo de ponto não fica disponível. Perfis PJ não usam escala de turno nem comparativo CLT.

Cada perfil CLT guarda uma lista de horários habituais reutilizáveis, não um horário diferente para cada dia. Os presets atuais são 06h–15h com almoço 12h–13h, 08h–17h com almoço 12h–13h, e 14h–22h52 com almoço 18h–19h. As escalas antigas por dia continuam legíveis para compatibilidade; ao editar e salvar, são convertidas para a lista habitual.

A jornada esperada nos dias úteis é de 8h; aos sábados é de 4h, sem intervalo fixo, e domingo é folga. Os horários iniciais esperados são arredondados à hora cheia mais próxima. Para calcular atrasos e classificar o registro, o sistema compara a entrada com todos os horários do perfil e usa o início mais próximo. Se as entradas previstas forem 08h e 14h, uma marcação às 13h se associa a 14h e não conta como atraso. A saída registrada no terceiro horário é 22h52; a previsão continua sendo 8h, conforme a regra de jornada definida.

O indicador de atrasos pode ser desligado para um perfil CLT com rotina variável. Nesse caso, os registros desse funcionário não entram nem no total geral nem no gráfico individual de atrasos. Faltas, horas extras e marcações permanecem inalteradas.

Na ficha do funcionário, administradores podem corrigir registros recentes dentro da janela de 96 horas e informam uma observação obrigatória, registrada na auditoria junto dos valores anteriores e novos. Para correções ou inclusões históricas, a tela exige motivo e grava os dados auditados pelo fluxo específico; a trava normal de 96 horas permanece ativa fora desse fluxo.

A migração também corrigiu o fuso de criação dos registros já existentes e mudou o padrão futuro para `now()`, para que a janela de 96 horas seja precisa no banco configurado em UTC.

### GitHub Pages

O workflow .github/workflows/pages.yml constrói e publica o site a partir de main. Em Settings → Pages, a fonte precisa permanecer como GitHub Actions. Em Settings → Secrets and variables → Actions → Variables, configure:

- VITE_SUPABASE_URL: endereço público do projeto Supabase.
- VITE_SUPABASE_ANON_KEY: chave anon ou publishable apropriada ao cliente.

A URL pública da aplicação é https://oc-mateus.github.io/KairoPont/. O README do repositório e o campo Homepage do GitHub apontam para esse endereço.

## Pendências para entrada em operação

Revisão atualizada em 5 de novembro de 2026. Confirme os itens abaixo antes de usar a aplicação com dados reais; os estados de serviços externos podem mudar sem alteração no repositório.

1. **Storage — pendente:** os buckets precisam receber limites e MIME types no servidor. Execute `npm run configure:storage` com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` fornecidos somente no ambiente local seguro. O script mantém documentos privados (10 MB; PDF, JPEG, PNG ou WebP) e fotos públicas (5 MB; JPEG, PNG ou WebP). A chave privilegiada não deve ir para arquivos `.env` do Vite nem para o Git.
2. **Proteção de senhas — pendente de configuração:** habilite no Supabase Auth a proteção contra senhas comprometidas e revise as regras de força de senha.
3. **Conta administrativa de teste:** uma conta de teste foi provisionada em 7 de outubro de 2026. Troque ou remova suas credenciais antes de usar a aplicação com dados reais.
4. **Convites e e-mail:** confira SMTP e URLs do Supabase Auth e configure `RESEND_API_KEY` e `FERIAS_EMAIL_FROM` como secrets da Edge Function.
5. **Dados de vínculo:** confira a data de admissão e os horários habituais de cada funcionário CLT com o RH.
6. **Teste de aceitação sem dados reais:** percorra convite, definição de senha, login, isolamento entre usuários fictícios, upload e link assinado de documento, registro e correção de ponto, férias e e-mails de aprovação/recusa. Os testes automatizados atuais não substituem essa validação ponta a ponta.
7. **Backups e retenção:** confirme que a retenção configurada no plano Supabase atende às necessidades da empresa; esse item não foi auditado.

Quando a gravação dos metadados de um documento falha, a aplicação tenta remover o objeto enviado. Se essa limpeza também falhar, o erro informa que o arquivo pode precisar de remoção administrativa.

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
