# Incidente fornecedores e correção dos critérios de publicação

Evento `ded076695de041eea926ae4e25ea5703`, Sentry issue `7780054836`, observado em **07/10/2026 às 22:06:54 (São Paulo)**. A URL `127.0.0.1:5002` corresponde ao container temporário do ensaio, anterior ao deploy das 22:09. O erro era um SELECT; não era uma gravação no banco operacional.

## Falhas confirmadas

1. O modo global do superadmin produz a sentinela `all`. A listagem usava essa string para contar produtos em uma coluna PostgreSQL inteira. O fallback respondia HTTP 200 e omitia as métricas, enquanto a exceção era registrada no Sentry.
2. Seis operações adicionais do módulo também usavam `all` em filtros inteiros: detalhe, pedidos, busca, estatísticas, relatório e exportação. A reprodução local anterior à correção registrou **7 falhas e 2 sucessos**. SQLite escondia parte do problema retornando resultados vazios, que foram reprovados por expectativas de conteúdo.
3. O dossiê de inteligência usava o mesmo filtro incorreto. A seleção do fornecedor agora respeita o escopo autorizado; suas consultas posteriores usam o estabelecimento numérico do fornecedor.
4. `SENTRY_DSN=''` era interpretado como autorização para usar o fallback embutido em configuração `production`. O ensaio, portanto, enviava erros ao projeto compartilhado com o frontend e com ambiente production.
5. O smoke exigia somente saúde/login e ausência de `success=false`. Não reprovava fallback, ausência de métricas ou conteúdo fora do escopo. A query `estabelecimento_id=2` não selecionava o estabelecimento no contexto do superadmin; o contrato requer `X-Establishment-ID`.

## Código corrigido

- Consultas de leitura de fornecedores suportam global autorizado e estabelecimento concreto; a contagem de produtos usa a loja numérica do fornecedor. Soft delete é aplicado também aos agregados.
- Acesso a fornecedor de outra loja devolve 404; exceções HTTP são preservadas nas consultas por ID.
- Fallback é identificado por `degraded=true`, preservando disponibilidade sem indicar resultado completo.
- DSN vazio explícito desativa monitoramento. DSN ausente preserva o destino padrão de produção. Testes desligam Sentry; o ensaio usa `release-stage`; a imagem nova publica o SHA em `SENTRY_RELEASE`.
- Smoke exige sucesso explícito e conteúdo válido, rejeita degradação e compara fornecedores/contagem de produtos com SELECT independente no banco correspondente.
- São verificados modos global e espelho das lojas 2 e 3 usando o header correto, estatísticas, detalhe, pedidos, produtos e busca. Rollback exige saúde/login; não atribui aprovação dos contratos novos à imagem anterior.

## Limites de cobertura

O smoke não é homologação de todos os módulos. Na produção, ele executa leituras e autenticação; escritas de compra/pagamento/estoque permanecem em testes e no ambiente isolado. Navegação e interações completas no navegador, todos os perfis, todos os endpoints, carga/alta disponibilidade e integração fiscal/pagamentos reais não foram certificados por esta verificação.

O GET `/fornecedores/<id>/inteligencia` chama uma sincronização que grava métricas; por isso ele é testado com banco descartável e não é chamado pelo smoke de produção. Essa característica e a atribuição de score 100 sem histórico, presentes na implementação anterior, requerem revisão funcional específica. Não confundir fornecedor sem histórico com desempenho comprovado.

Os sete aceites ERP pendentes da auditoria anterior continuam pendentes. Este documento acrescenta os defeitos efetivamente reproduzidos; não limita a quantidade de defeitos existentes ao número de testes conhecidos.

## Evidência local

Correção inicial: 27 regressões de fornecedores aprovadas. Validação conjunta: **61 passed** (fornecedores, Sentry, contratos do smoke e isolamento). Testes adicionais cobrem o dossiê e negação de leitura entre lojas. Logs locais privados em `scratch/git-review/sentry-regression-*.log`.

CI PostgreSQL e publicação desta correção serão registrados abaixo após a execução efetiva.
