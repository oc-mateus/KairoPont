# Revisão funcional e publicação — 10 de novembro de 2026

## Correções entregues

- Contato identifica a Kairo Automações e o responsável pelo projeto.
- Licenças têm página própria, busca, textos expansíveis e download do arquivo original. Avisos idênticos aparecem uma única vez na consulta; versões diferentes são preservadas.
- Uma aba aberta antes de uma publicação recupera automaticamente uma falha ao buscar um módulo antigo. A recuperação é limitada a uma recarga por versão para evitar ciclos.
- Ponto, histórico, documentos, férias, indicadores, funcionários, calendário e auditoria distinguem falha de carregamento de uma lista realmente vazia e oferecem nova tentativa.
- A marcação de ponto fica indisponível quando a consulta da jornada falha, até os registros serem confirmados novamente.
- Respostas antigas do histórico não substituem o resultado do filtro atual. Os registros são limpos durante a busca para impedir a exportação de um período anterior com o filtro novo.
- O envio de documento valida as datas, usa nome de armazenamento aleatório e mantém os campos e o cancelamento bloqueados enquanto o envio está em andamento.
- Nome, cargo e foto têm campos identificados para tecnologias assistivas; o perfil valida os dados e exige confirmação da linha atualizada antes de mostrar sucesso.
- Janelas têm nome acessível, navegação por Tab restrita ao conteúdo, fechamento por Escape e devolução do foco ao controle que as abriu.
- Erros de credenciais aparecem em português; a saída da conta trata falhas. A consulta do perfil deixa de aguardar indefinidamente após 15 segundos.
- Administradores voltam ao painel após salvar uma nova senha. As páginas de ajuda e informações públicas continuam disponíveis durante a recuperação de senha.
- Novos horários de criação de cadastros, documentos e auditoria usam o instante correto do servidor. A conversão anterior retirava três horas ao gravar e provocava uma segunda conversão na exibição. A correção não altera marcações de jornada nem reescreve datas históricas.

## Evidências

| Verificação | Resultado |
| --- | --- |
| Testes automatizados locais | 81 aprovados, incluindo horários em UTC e São Paulo e preservação dos metadados históricos |
| Funções de servidor | Verificação de tipos aprovada; 2 testes com 20 etapas aprovados |
| Dependências de produção | Zero vulnerabilidades conhecidas na auditoria executada |
| Compilação de produção | Aprovada, incluindo o subdiretório `/KairoPont/` |
| Documentos de publicação | Metadados, rotas, ícones, sitemap e arquivos obrigatórios conferidos |
| APIs de produção sem sessão | 46 verificações aprovadas |
| Permissões do banco em produção | Suítes `security.sql` e `penetration.sql` aprovadas, com reversão transacional das fixtures |
| Conta temporária real | Login CLT/PJ, entrada, saída, troca de senha, saída da conta, atualização de perfil e foto, envio e download privado de documento, consulta de férias, PDF e Excel exercitados contra o serviço real |
| Administração | Painel, ficha do funcionário temporário, calendário e auditoria carregaram; falhas e novas tentativas verificadas |
| Responsividade | 12 páginas públicas e 4 telas administrativas conferidas em 320, 390, 768 e 1440 px, sem transbordamento horizontal nas verificações |
| Falhas simuladas | Recuperação em 4 fluxos de funcionário e 4 administrativos; troca rápida de filtros sem sobrescrita por resposta antiga |
| Publicação com aba antiga | Falha de módulo simulada no navegador: uma recarga, carregamento concluído e ausência de ciclo |
| Teclado | Foco contido na janela de envio, Escape e retorno ao botão de abertura verificados |

Os testes visuais usaram a compilação final local conectada ao Supabase de produção. Falhas de rede e respostas atrasadas foram injetadas somente no navegador de teste. Após a publicação, as 12 páginas públicas passaram novamente pela conferência nas quatro larguras. O login PJ e o histórico foram conferidos também no endereço público, assim como a identificação da empresa e a página de licenças. A [publicação final](https://github.com/oc-mateus/KairoPont/actions/runs/42887879351) terminou com sucesso; o site respondeu HTTP 200 e o código de recuperação de versão foi confirmado no arquivo servido.

## Pendências e limites

1. **Recebimento de e-mails:** conferir convite e recuperação de senha com uma caixa de testes controlada, além dos avisos automáticos de suporte e férias. Nesta revisão a troca de senha foi real; o recebimento em uma caixa postal não foi validado. Nenhuma mensagem de teste foi enviada aos funcionários.
2. **Proteções de acesso adicionais:** o verificador do Supabase ainda aponta proteção contra senhas vazadas desabilitada. MFA para administradores e CAPTCHA precisam de configuração e validação do fluxo; não foram impostos de forma que pudesse bloquear as contas atuais. Consulte a [documentação de senhas do Supabase](https://supabase.com/docs/guides/auth/password-security).
3. **Recuperação operacional:** executar e documentar um ensaio de restauração de backup, com responsável e prazo definido. Esse procedimento não foi realizado nesta revisão.
4. **Cobertura contínua:** repetir os testes de aceitação quando regras de jornada, permissões, integrações ou serviços externos mudarem. Os testes atuais são evidência dos cenários exercitados, não uma garantia de ausência de qualquer erro futuro, de disponibilidade dos provedores ou de acessibilidade integral.
5. **Metadados históricos:** os horários antigos de criação de cadastros, documentos e auditoria podem conservar o desvio de três horas. Uma eventual correção exige conferir quais registros vieram do valor padrão defeituoso e quais foram importados ou informados explicitamente. Nenhum ajuste em massa foi aplicado a registros reais nesta revisão.

Os avisos sobre funções de banco com privilégios elevados foram revisados junto das verificações de autorização. Essas funções fazem parte dos fluxos controlados e não foram removidas apenas para eliminar um aviso do verificador. Nenhuma tabela pública foi encontrada com RLS desligada; documentos continuam privados e avatares continuam públicos conforme o produto atual.

## Limpeza dos testes

A conta foi criada especificamente para esta revisão, sem reutilizar funcionários reais. A limpeza foi concluída após a conferência da publicação: documento e foto removidos pelo serviço de armazenamento, sessões revogadas e conta, perfil, marcações, metadados de documento e período de férias temporários apagados. As credenciais locais de teste também foram removidas.

A consulta final confirmou zero contas, perfis, marcações, documentos, períodos de férias, sessões, objetos de armazenamento e políticas temporárias associados à identidade de teste. A base retornou às contagens iniciais de cinco perfis e sete contas de autenticação. Os registros reais não foram apagados.
