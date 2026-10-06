# KairoPont - Sistema de Controle de Ponto

Aplicação web completa e responsiva desenvolvida para a **Kairo Automações** para o registro seguro e confiável de ponto dos funcionários.

## Funcionalidades Principais

*   **Autenticação Dupla:** Login via E-mail ou CPF.
*   **Registro Seguro:** Ponto registrado sempre com horário gerado diretamente no servidor (Supabase), não confiando no relógio local do dispositivo.
*   **Prevenção de Erros:** Bloqueio de cliques duplos e sequência obrigatória (Entrada -> Saída Almoço -> Retorno Almoço -> Saída).
*   **Exportação Múltipla:** Relatórios em PDF, CSV e Markdown (ideal para exportar pro Notion).
*   **Envio de Documentos:** Upload privado e seguro de atestados médicos e declarações.
*   **Painel Administrativo:** Gestão de funcionários, visualização de registros gerais, acesso a documentos e log de auditoria.

## Pré-requisitos

*   [Node.js](https://nodejs.org/en/) (versão 18 ou superior recomendada)
*   Conta no [Supabase](https://supabase.com) (projeto criado)

## Instalação Local

1.  No terminal, instale as dependências:
    ```bash
    npm install
    ```

2.  Crie um arquivo `.env` na raiz do projeto com base no modelo fornecido:
    ```bash
    cp .env.example .env
    ```

3.  Preencha as variáveis de ambiente no `.env` com as informações do seu projeto no Supabase:
    *   `VITE_SUPABASE_URL`: A URL do seu projeto (encontrada em Settings > API).
    *   `VITE_SUPABASE_ANON_KEY`: A chave pública/anon do seu projeto (encontrada em Settings > API).

4.  Inicie o servidor de desenvolvimento:
    ```bash
    npm run dev
    ```

5.  Acesse a aplicação no navegador, normalmente em `http://localhost:5173`.

## Configuração do Supabase

O projeto `KairoPont` precisa ter as migrações aplicadas nesta ordem:

1. `supabase/migrations/20261006000000_initial_schema.sql`
2. `supabase/migrations/20261006001000_security_hardening.sql`
3. `supabase/migrations/20261006002000_restrict_internal_trigger.sql`

A segunda migração corrige permissões da primeira: funcionário lê apenas o próprio perfil, ponto e documentos; alterações de papel/status passam por RPC com verificação administrativa; e o RPC de ponto valida a identidade do funcionário e mantém data/hora geradas no servidor em `America/Sao_Paulo`. A rotina de cadastro cria sempre papel `employee`; ela não concede privilégios administrativos com base em um endereço de e-mail enviado pelo cadastro.

Depois de confirmar no Supabase que a conta administrativa foi criada e o e-mail foi verificado, atribua o papel pelo SQL Editor como administrador do projeto. Use o UUID da conta verificada exibido em Authentication → Users:

```sql
UPDATE public.funcionarios AS f
SET role = 'admin'
FROM auth.users AS u
WHERE f.auth_id = u.id
  AND f.auth_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND u.email_confirmed_at IS NOT NULL;
```

Substitua o UUID de exemplo pelo UUID real da conta e confirme que a atualização afetou exatamente uma linha antes de considerar a conta administradora. Não execute esse comando pela aplicação.

A migração cria, se ainda não existirem, os buckets `documentos` (privado) e `fotos-funcionarios` (público, conforme a funcionalidade de avatar). Ela não altera a visibilidade de buckets já existentes; verifique no painel que `documentos` está privado. Documentos médicos usam pastas vinculadas ao funcionário, e as políticas do Storage restringem leitura ao próprio funcionário ou a um administrador.

O repositório não contém código de Edge Functions. A exportação disponível é local; nenhuma função `notion-export` nem segredo do Notion é necessária para a aplicação atual.

## Publicação no GitHub Pages

O workflow `.github/workflows/pages.yml` constrói o frontend quando há push na branch `main` e publica o diretório estático no GitHub Pages. Em **Settings → Pages**, selecione publicação por **GitHub Actions**. Em **Settings → Secrets and variables → Actions → Variables**, configure:

- `VITE_SUPABASE_URL`: URL pública do projeto Supabase `KairoPont`.
- `VITE_SUPABASE_ANON_KEY`: chave pública `anon`/publishable apropriada ao cliente.

Esses valores são incorporados ao frontend publicado e não são segredos privilegiados. Nunca use `service_role`, chaves secretas, senhas ou tokens nessa configuração. O caminho base do projeto é calculado pelo workflow; o roteamento suporta recarregar rotas internas do GitHub Pages. Para o repositório `oc-mateus/KairoPont`, o endereço esperado no domínio padrão é `https://oc-mateus.github.io/KairoPont/`.

No painel Supabase, adicione `https://oc-mateus.github.io/KairoPont/` à lista de URLs permitidas da autenticação, incluindo também o padrão de retorno usado pelo provedor.
