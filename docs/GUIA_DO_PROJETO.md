# KairoPont — guia do projeto

Revisado em 7 de outubro de 2026

**Aplicação:** [https://oc-mateus.github.io/KairoPont/](https://oc-mateus.github.io/KairoPont/)  
**Código-fonte:** [https://github.com/oc-mateus/KairoPont](https://github.com/oc-mateus/KairoPont)

## Resumo executivo

KairoPont é uma aplicação web da Kairo Automações para registrar a jornada dos funcionários, consultar históricos e enviar atestados médicos ou declarações de horas. O frontend é servido pelo GitHub Pages; autenticação, banco de dados e armazenamento de arquivos usam o Supabase.

O site está publicado e o workflow automatizado de build e publicação está ativo. O banco tem o esquema e as políticas das migrações do projeto. Em 7 de outubro de 2026 foi provisionada uma conta administrativa destinada a testes; valide os fluxos apenas com dados fictícios e revise as credenciais antes da operação real.

A aplicação também pode ser instalada como PWA em navegadores compatíveis. No Android, abra o endereço HTTPS no Chrome e use **Instalar aplicativo** (no botão do sistema, quando disponível, ou no menu do navegador). O modo instalado abre em janela própria; recursos que dependem do Supabase ainda precisam de conexão. O Chrome para iOS não oferece o mesmo fluxo de instalação do Android; nesse sistema, use a opção de adicionar à tela inicial oferecida pelo navegador compatível.

**O projeto ainda não está validado para operação real.** Antes de registrar jornadas da equipe, é necessário configurar os redirecionamentos do Supabase Auth, provisionar e verificar a conta inicial de administração e reforçar a validação de arquivos no servidor. O acesso é feito com e-mail corporativo e senha; o CPF continua sendo usado no cadastro e na identificação do funcionário.

## O que a aplicação oferece

### Para funcionários

- Entrar com e-mail e senha.
- Cadastrar uma conta com nome, e-mail, CPF, cargo e senha.
- Registrar quatro etapas de jornada na ordem: entrada, saída para almoço, retorno do almoço e saída.
- Consultar o próprio histórico e exportá-lo para PDF, Excel (.xlsx) ou Markdown.
- Enviar atestado médico ou declaração de horas e baixar documentos autorizados.
- Atualizar dados básicos do perfil e a foto.

### Para administradores

- Consultar indicadores e registros da equipe.
- Gerenciar perfis e status de funcionários.
- Selecionar um funcionário para consultar nome completo, CPF, cargo, registros de ponto e documentos enviados, incluindo data e tipo.
- O menu administrativo concentra-se no Painel Admin e em Funcionários; ponto e documentos são acessados pela ficha individual.
- Filtrar os registros individuais por dia, semana, mês ou período personalizado e baixar o resultado em Excel (.xlsx) ou PDF.
- Baixar documentos individuais por links assinados temporários.

Os relatórios PDF de ponto do funcionário e do administrador exibem no cabeçalho a logo oficial da Kairo e o lockup próprio do KairoPont. As planilhas Excel incluem título, período, data de geração, cabeçalho estilizado, filtros e colunas dimensionadas para exibir datas e horários sem cortes. As telas usam navegação adaptada para celular, formulários em coluna e tabelas roláveis ou convertidas em cartões nos breakpoints móveis.

Operações administrativas dependem do papel armazenado no banco. O cadastro público cria novos perfis como funcionário; não há promoção de papel no frontend.

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

As migrações criam quatro tabelas no esquema public:

| Tabela | Dados armazenados | Proteção aplicada |
| --- | --- | --- |
| funcionarios | Perfil, vínculo com Auth, CPF, cargo, status e papel | Funcionário consulta o próprio perfil; admin pode consultar a equipe |
| registros_ponto | Data e quatro marcações de horário | Funcionário consulta os próprios registros; admin consulta a equipe |
| documentos | Tipo, nome, caminho no Storage e período informado | Funcionário consulta os próprios metadados; admin consulta os autorizados |
| auditoria | Ação administrativa, alvo e detalhes | Leitura limitada ao perfil admin |

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

O projeto KairoPont já registrava as três migrações, com os buckets documentos (privado) e fotos-funcionarios (público). Não reaplique nem resete o banco de produção para seguir este guia.

### GitHub Pages

O workflow .github/workflows/pages.yml constrói e publica o site a partir de main. Em Settings → Pages, a fonte precisa permanecer como GitHub Actions. Em Settings → Secrets and variables → Actions → Variables, configure:

- VITE_SUPABASE_URL: endereço público do projeto Supabase.
- VITE_SUPABASE_ANON_KEY: chave anon ou publishable apropriada ao cliente.

A URL pública da aplicação é https://oc-mateus.github.io/KairoPont/. O README do repositório e o campo Homepage do GitHub apontam para esse endereço.

## Pendências para entrada em operação

As verificações abaixo foram feitas em 6 de outubro de 2026. Reconfirme o estado antes de usar a aplicação com funcionários.

1. **Configurar Auth:** definir a URL do site no Supabase Auth como https://oc-mateus.github.io/KairoPont/ e adicionar o retorno exato à lista permitida. A configuração não foi confirmada no painel.
2. **Revisar a administração de teste:** uma conta administrativa de teste foi provisionada em 7 de outubro de 2026. Troque ou remova suas credenciais antes de usar a aplicação com dados reais.
3. **Revisar cadastro público:** a tela permite auto cadastro e o gatilho cria perfis de funcionário. Definir se o acesso será aberto, restrito ou precedido por convite antes de divulgar o endereço aos funcionários.
4. **Impor validação no Storage:** configurar no bucket privado o limite máximo e os MIME types adequados no servidor, além da validação existente no frontend.
5. **Evitar arquivos órfãos:** se o insert dos metadados falhar, remover o objeto enviado ou disponibilizar um processo administrativo de reconciliação.
6. **Validar sem dados reais:** testar cadastro, confirmação, login, isolamento entre dois usuários fictícios, envio de arquivo descartável, link assinado e fluxo admin antes da ativação.

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
