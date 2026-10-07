# Auditoria de segurança e desempenho — MercadinhoSys

Atualizada em 06/10/2026. Infraestrutura recuperada do chat anterior e confirmada por SSH: backend, PostgreSQL 15 e Redis na Oracle; frontend na Vercel. Ambiente publicado contém somente seed, sem clientes reais, conforme informado pelo proprietário. As correções deste ciclo permanecem no workspace; não foram publicadas.

## Resultado verificado

- Regressão completa local: **287 testes aprovados e 11 pulados** em 298 coletados, 127,07s. Oito skips exigem PostgreSQL e foram executados separadamente na Oracle; três pertencem às suites de métricas. Inclui os dois cancelamentos com pagamentos fiados múltiplos e as seis regressões SFA. Há 3.912 warnings de APIs legadas/depreciações, registrados como dívida técnica.
- PostgreSQL Oracle: **60 testes aprovados**, incluindo oito provas de concorrência nas duas APIs de venda. Rodada adicional: **12 testes aprovados** de migração, webhook, helpers, upload, documentos privados e cancelamento de fiado em banco descartável.
- Navegador: **4 testes aprovados** no build final: login seed real, dashboard, produtos/clientes/vendas/PDV, acesso público e decodificação EAN-13 pelo Quagga. Não foram executadas todas as jornadas comerciais de ponta a ponta na UI.
- TypeScript e build Vite/PWA aprovados. Chunk inicial: 859,68KB → **552,82KB**, gzip 279,94KB → **187,80KB**. Tailwind 4/Cypress 16 migrados e testados. Precache PWA ainda soma 5.335,14KiB; CSS 382,59KB. Avisos de chunk >500KB e padrões SVG ausentes permanecem.
- **npm audit: zero alertas**; **pip-audit: zero vulnerabilidades conhecidas** nos 85 pacotes resolvidos. A consulta direta PyPI aos requisitos fixos também terminou sem alertas/erros. Isso não significa inexistência de vulnerabilidades desconhecidas nem atualização das imagens atualmente publicadas.
- Efí sandbox: criação de cobrança de R$1, consulta e cancelamento retornaram **200/200/200**. Nenhum pagamento de produção foi realizado. Esse ciclo não certifica liquidação, recorrência nem entrega externa de webhook.

## Correções de segurança e negócio

| Achado | Correção |
|---|---|
| Tenant escapava por limit/offset e update/delete em lote | Filtro da loja e exclusão lógica mantido em TenantQuery; testes entre duas lojas |
| JWT preservava privilégios após revogação | Estado/papel atual do funcionário validado também fora do mapa de recursos e em refresh |
| RH alterava privilégios; bootstrap público | Campos sensíveis restringidos; bootstrap desativado |
| Sync vazio e restore global de administrador de loja | Segredo obrigatório, comparação constante, superadmin e restrição do caminho |
| Venda aceitava dados financeiros incoerentes | Validador comum com Decimal, valores finitos, limites de itens e totais/pagamentos coerentes |
| Operador/cliente de loja diferente | Identidade do JWT; cliente/produto no escopo da loja |
| Troco inflava o caixa | Dinheiro líquido de troco; fechamento e estorno reconciliados |
| Concorrência de estoque/fiado/UUID | Ordem de locks caixa→cliente→produtos, produtos ordenados por ID; advisory lock tenant+UUID no PostgreSQL |
| Venda não consumia lotes; cancelamento não os restaurava | Consumo por validade, rastreabilidade no ledger e restauração dos lotes na anulação |
| PIN confiava em nivel_acesso divergente do role | Autorização usa RBAC canônico e estado atual do autorizador; cancelamento unificado nas duas APIs |
| Cancelamento de fiado afetava apenas primeira conta | Todas as contas abertas canceladas; saldo em Decimal |
| Desconto podia ser escondido no preço unitário | Servidor aplica permissões e limites já apresentados pelo PDV; exceção existente do administrador preservada |
| Webhook retornava sucesso após falha do provedor | Confirmação após consulta válida; 502/503 em falhas para permitir retentativa |
| Repetição paid/settled prorrogava assinatura novamente | Evento persistente, chave única e lock por cobrança; migração `f4c6a8b0d2e4` |
| Logo confiava em extensão/MIME enviado | Conteúdo validado com Pillow; MIME derivado do formato, limite de pixels |
| XLSX compactado ampliava memória sem limite | Limite de 50MB descompactados, 2.000 entradas e 10 mil linhas |
| XML aceitava declarações DTD/entidades | Rejeição explícita e limite de 5MB |
| Documentos locais públicos | Download exige conta ativa, vínculo com loja e permissão; bloqueio de traversal, no-store/nosniff/sandbox; links da UI usam requisição autenticada |
| Novos documentos pessoais iam ao Cloudinary público | CNH/CRLV/atestados ficam no volume privado; URLs públicas históricas exigem inventário/migração antes de dados reais |
| SFA offline vinculava cliente/vendedor/produto de outra loja | Referências validadas no tenant, valores finitos e limite global de itens; códigos automáticos únicos no lote |
| Configuração registrava valores fiscais privados em log | Log registra apenas nomes dos campos atualizados |
| Helpers SQL de produto/funcionário não tinham escopo explícito | Filtro por tenant e exclusão lógica; usuário autenticado reaproveitado sem consultas adicionais |

O algoritmo chamado FIFO no sistema ordena por validade (FEFO). Não foi trocada essa regra. Venda sem lotes históricos e restauração de movimentos antigos sem rastreabilidade continuam seguindo o legado; não se inventou distribuição de lotes antigos.

## Concorrência no PostgreSQL

Executado com a aplicação nova em container separado, banco `audit_security_20261006`, Redis DB3 e sem porta pública. O banco é criado/removido pelo executor; fixtures recusam nomes que não começam por `audit_security_`. Não foram alteradas as tabelas do seed publicado.

Nas duas APIs (`/api/pdv/finalizar` e `/api/vendas/`):

- Seis compras para cinco unidades: cinco vendas aprovadas e uma rejeitada; estoque/lotes zerados, caixa coerente.
- Cinco compras fiadas de R$10 para limite R$30: três aprovadas e duas rejeitadas; dívida R$30.
- Quatro retries do mesmo UUID: uma criação e três respostas idempotentes; uma venda e um único débito de estoque/caixa.
- Compra de quatro unidades em lotes de três e duas: saldo dos lotes zero e um.

A nova migração de webhook foi testada com downgrade, upgrade e upgrade repetido no SQLite e PostgreSQL. **Ela precisa ser aplicada antes de publicar o backend novo**; não foi aplicada ao banco publicado.

## Carga e capacidade observadas

Oracle VM.Standard.E2.1.Micro, aproximadamente 954MiB RAM e 2GiB swap. Configuração publicada: Gunicorn 1 worker/4 threads, pool 2 + overflow 1; PostgreSQL `max_connections=25`. Snapshot: 8 conexões totais. Lojas seed: **101, 8, 10 e 14 produtos ativos**.

Redis: limite 24MiB, política noeviction, ~1,26MB usados, zero evictions no snapshot. Há uso pelo limitador; **REDIS_URL não está configurado no backend publicado**, portanto cache de aplicação ainda local. A variável foi adicionada ao compose do workspace. Agregados de giro continuam cacheados por processo; não se afirma que todos os caches sejam distribuídos.

Benchmark: PostgreSQL real e Redis na Oracle, banco separado, catálogos sintéticos de 101/5.000 produtos com dois lotes por produto; 100 amostras por rota e nível de concorrência após três aquecimentos, sessões novas. Transporte **Flask test client/WSGI direto**, sem medir rede, TLS, Caddy ou fila do Gunicorn. p99 com 100 amostras é estimativa de cauda de uma rodada, não SLO garantido. Zero erros nas 1.200 solicitações das duas rodadas finais.

| Catálogo | Rota | Concorrência | p95 | p99 | req/s |
|---|---|---:|---:|---:|---:|
| 101 produtos | Produtos, página 20 | 1 | 98,01ms | 107,23ms | 14,33 |
| 101 produtos | Produtos, página 20 | 4 | 297,11ms | 376,19ms | 19,33 |
| 101 produtos | Produtos, página 20 | 8 | 1.182,56ms | 1.310,53ms | 11,60 |
| 101 produtos | PDV código de barras | 4 | 195,52ms | 387,77ms | 31,21 |
| 5.000 produtos | Produtos, página 20 | 4 | 901,10ms | 1.084,22ms | 6,59 |
| 5.000 produtos | PDV código de barras | 4 | 113,87ms | 205,50ms | 47,54 |
| 5.000 produtos | Produtos, página 20 | 8 | 1.716,27ms | 2.203,91ms | 8,85 |

A busca do PDV usa igualdade indexável antes do fallback parcial e consulta apenas lotes relevantes. A listagem busca lotes pelos IDs da página (selectinload após count), evitando repetir a subconsulta do catálogo. Na comparação Oracle de 5.000 produtos/concorrência 4, p99 da listagem caiu de 1.504,29ms para 1.084,22ms; p95 de 995,68ms para 901,10ms. Há variação da VM compartilhada: não anunciar esses valores como capacidade garantida.

Benchmark SQLite anterior: p95 do PDV 39,27ms → 5,36ms, 5.000 produtos/10.000 lotes. É evidência local da otimização, não substitui a medição Oracle. A VM Micro atinge latências altas em maior concorrência; aumentar apenas o pool não resolve limitação de CPU/memória.

## Matriz e pendências concretas

A matriz completa desta auditoria está em `docs/MATRIZ_REQUISITOS_TESTES_SEGURANCA.md`, com regra, teste e lacunas. Não há certificação de TODAS as políticas comerciais nem de todos os 319 handlers inventariados.

Antes de publicar/certificar:

1. Validar capacidade HTTP completa e jornada de venda/cancelamento na UI contra a aplicação nova isolada; o E2E atual prova login/navegação/scanner e o backend prova as transações.
2. Configurar fiscal externo em homologação. Snapshot: cinco lojas com gateway simulado e zero tokens fiscais; testes simulados não provam SEFAZ.
3. Exercitar liquidação/assinatura recorrente e webhook realmente entregue pela Efí; criação/consulta/cancelamento sandbox já passaram.
4. Consolidar políticas comerciais de alteração de preço, lotes com preço especial, estorno de parcelas já liquidadas e corrida fechamento/checkout; não presumir regras ausentes.
5. Completar revisão semântica de SQL direto restante e inventário/migração de URLs públicas antigas de documentos.
6. Aplicar migração, recriar imagem com dependências corrigidas e configurar cache Redis no momento da publicação, com backup/rollback verificados.

O executor inicial de auditoria expôs argumentos de um subprocesso em uma exceção, incluindo credencial do PostgreSQL. Foi corrigido para não imprimir o comando/ambiente; a credencial não está neste relatório. A senha interna do PostgreSQL foi trocada e o sistema voltou saudável em 06/10/2026, antes de chegar a instrução do usuário para não rotacionar credenciais. Nenhuma chave de API foi alterada. Não realizar novas rotações: as credenciais internas pertencem ao ambiente seed e o usuário explicitamente determinou preservá-las.

## Evidências reproduzíveis

- `backend/scripts/benchmark_security.py` e `infra/oracle/run-security-audit.py`.
- `scratch/oracle-load-output.json` (antes), `scratch/oracle-load-after.json`, `scratch/oracle-load-seed.json`.
- `scratch/npm-audit-final.json`, `scratch/python-security-audit.json`, `scratch/python-audit-resolved.json`.
- `infra/oracle/security-readonly-snapshot.py`, `infra/oracle/verify-payment-sandbox.py`.
- `backend/tests/test_security_audit.py`, `backend/tests/test_postgres_checkout_concurrency.py`.
- `cypress/e2e/security-regression.cy.ts`, `cypress/e2e/smoke.cy.ts`.

A produção publicada mantém a versão anterior. Nenhum deploy de correções, upgrade pago, transação financeira de produção ou emissão fiscal real foi realizado neste ciclo.
