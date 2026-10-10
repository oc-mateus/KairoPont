<p align="center">
  <img src="public/assets/brand/adesivo_nome_simbolo.png" alt="Kairo Automações" width="380" />
</p>

<h1 align="center">KairoPont</h1>
<p align="center"><strong>Controle de jornada da Kairo Automações</strong></p>

<p align="center">
  <a href="https://oc-mateus.github.io/KairoPont/">Abrir aplicação</a> ·
  <a href="https://github.com/oc-mateus/KairoPont">Ver repositório</a>
</p>

---

O KairoPont organiza o registro de jornada, a consulta de históricos e o envio de documentos dos funcionários. A aplicação web fica no GitHub Pages; autenticação, banco de dados e arquivos usam o Supabase.

## Como funciona

```mermaid
flowchart LR
    A[Funcionário seleciona CLT ou PJ e entra] --> B{Tipo de vínculo}
    B -->|CLT| C[Registra entrada]
    C --> D[Intervalo fixo calculado automaticamente]
    D --> E[Registra saída]
    B -->|PJ| F[Registra entrada e saída]
    E --> G[Consulta histórico e folha de ponto]
    F --> G
```

O Supabase valida o tipo de vínculo e a sequência das marcações e grava os horários oficiais no servidor, no fuso de São Paulo. Funcionários PJ registram entrada e saída e acompanham o total de horas trabalhadas; funcionários CLT também registram somente entrada e saída, com almoço fixo calculado a partir do turno. O funcionário consulta os próprios registros e pode exportar o histórico.

### Recursos

| Funcionário | Administrador |
| --- | --- |
| Escolher CLT ou PJ no login e registrar o próprio ponto | Acompanhar faltas, atrasos e horas extras de CLT |
| Consultar o próprio histórico | Gerenciar perfis e status de funcionários |
| Exportar folha de ponto em PDF ou Excel | Pesquisar funcionários por nome, CPF e cargo e ordenar alfabeticamente |
| Enviar e consultar documentos autorizados | Distinguir CLT/PJ e ver resumo de horas PJ e extras CLT |

O painel de frequência filtra mês atual, mês/ano específico, últimos seis meses ou último ano. Quando um mês específico não tem registros CLT, o painel informa que não há dados para aquele período. A folha de ponto identifica o vínculo; CLT apresenta turno e almoço fixo, enquanto PJ apresenta apenas entrada, saída e horas computadas.

O cadastro cria perfis de funcionário. A atribuição do papel de administrador é feita de forma controlada no banco, nunca pelo frontend.

## Privacidade e situação atual

- As políticas RLS limitam funcionários aos próprios dados; ações administrativas exigem perfil de administrador.
- O bucket `documentos` é privado. O bucket de fotos de perfil é público para exibir avatares.
- A tela valida formato e tamanho de arquivo, mas essas restrições ainda precisam ser configuradas no próprio Storage para serem impostas no servidor.
- O acesso é feito com e-mail e senha, com seleção do vínculo CLT/PJ validada contra o cadastro do funcionário. Administradores podem usar qualquer opção. O CPF é solicitado no cadastro e usado para identificar o funcionário, não para entrar.

O site está publicado. Antes do uso operacional, ainda é necessário concluir a configuração de redirecionamento do Auth, provisionar a conta administrativa e reforçar a validação de arquivos no Storage.

## Desenvolvimento local

Requisitos: Node.js 18 ou superior, npm e acesso ao Supabase `KairoPont`.

```bash
npm install
cp .env.example .env
npm run dev
```

Preencha no `.env` local `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores públicos apropriados ao cliente. Não envie `.env`, chaves privilegiadas, senhas ou tokens ao GitHub.

## Banco e publicação

As migrações devem ser aplicadas na ordem em que estão nomeadas em [`supabase/migrations`](supabase/migrations). O workflow [Publicar no GitHub Pages](.github/workflows/pages.yml) constrói e publica a branch `main`. As variáveis de build são configuradas no GitHub em **Settings → Secrets and variables → Actions → Variables**.

As instruções de configuração estão descritas nas migrações SQL, no workflow e nas variáveis do repositório.
