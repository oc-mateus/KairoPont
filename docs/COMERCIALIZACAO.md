# Comercialização e operação do KairoPont

Atualizado em 5 de novembro de 2026. Este documento descreve uma entrada comercial controlada. Ele não substitui validação jurídica, definição de preço, contrato ou configuração do ambiente do cliente.

## Caminho recomendado para os primeiros pilotos

Começar com implantação gerenciada e isolada por cliente, mantendo um projeto Supabase separado para cada empresa. Isso evita compartilhar a base atual enquanto a demanda e os requisitos de cada cliente são validados. Cada implantação precisa de sua própria configuração de frontend, projeto Supabase, storage, usuários administradores, domínio e rotina de suporte.

A aplicação ainda não oferece arquitetura multiempresa. Não conecte várias empresas à base atual contando apenas com filtros na interface. Antes de oferecer uma instância SaaS compartilhada, implemente e teste organizações, membros, papéis por organização, chaves de unicidade por organização, políticas RLS, funções do banco, uploads, relatórios, convites e rotinas administrativas com isolamento por organização.

## Bloqueios antes de armazenar dados de um cliente piloto

- [ ] Remover ou rotacionar a conta administrativa de teste e confirmar a identidade do administrador real.
- [ ] Executar `npm run configure:storage` em ambiente seguro para aplicar as restrições server-side dos dois buckets: documentos privados (10 MB; PDF, JPEG, PNG e WebP) e fotos públicas (5 MB; JPEG, PNG e WebP). Reavaliar se o bucket de fotos deve continuar público para cada cliente.
- [ ] Habilitar proteção do Supabase Auth contra senhas comprometidas e definir a política de senha.
- [ ] Exigir MFA para administradores; validar o fluxo completo e o nível de autenticação exigido em operações sensíveis.
- [ ] Confirmar SMTP, URLs de redirecionamento, e-mail do Resend e secrets das Edge Functions em cada projeto.
- [ ] Fazer teste de ponta a ponta com contas fictícias: convite, ativação, recuperação de senha, papéis, isolamento, ponto, correção auditada, férias, upload, download assinado e notificações.
- [ ] Confirmar backups, retenção, procedimento de restauração, prazo de resposta e responsável por incidentes.
- [ ] Validar os horários, fuso, calendário de feriados e regras de jornada de cada cliente.
- [ ] Revisar política de privacidade, contrato de tratamento de dados, retenção, exportação e encerramento com assessoria adequada antes de receber dados reais.

## Operação e proteção do repositório

- Pull requests para `main` agora passam por testes, auditoria das dependências de produção e build.
- Ative proteção da branch `main` nas configurações do GitHub, exigindo revisão e o workflow aprovado. A configuração remota da branch não é gerenciada pelo código local.
- Proteja o ambiente `github-pages` com aprovação, se o plano do GitHub permitir, e publique somente a partir de `main`.
- Aplique migrações em homologação antes da produção. O workflow de Pages não aplica migrações nem publica Edge Functions.
- Revise alertas do Dependabot e atualize dependências com pull requests.
- Não armazene chaves privilegiadas em `.env`, variáveis Vite, issues, logs ou no repositório.
- Defina a estratégia do código-fonte antes de vender: repositório privado para distribuição proprietária ou licença explícita para distribuição aberta. Tornar o repositório privado pode afetar a hospedagem GitHub Pages conforme o plano contratado.

## Requisitos para venda recorrente

Defina preço, limites, onboarding, atendimento, disponibilidade, exportação e eliminação de dados antes de oferecer planos. O portal e o banco atuais foram montados para a Kairo Automações; os textos comerciais devem dizer com clareza que o piloto depende de implantação e validação dos parâmetros de jornada da empresa.

Não prometa conformidade trabalhista universal. Os cálculos e escalas atuais refletem parâmetros específicos já cadastrados no produto. Confirme a adequação das regras e relatórios para cada cliente com profissionais responsáveis.

## Critério para considerar pronto

Um piloto está pronto quando o ambiente do cliente está isolado, as pendências de segurança e operação acima foram resolvidas, os testes de aceitação passaram e o cliente aprovou os horários, dados e relatórios antes da entrada em produção.
