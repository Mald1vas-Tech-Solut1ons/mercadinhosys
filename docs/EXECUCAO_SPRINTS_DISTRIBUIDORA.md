# Execução das sprints — distribuidora/importadora

Registro vivo da execução do [plano CTO/Scrum](PLANO_CTO_SCRUM_DISTRIBUIDORA_2026-10-07.md). Estados: pendente, em andamento, em validação, concluído, bloqueado. "Local" = testado no workspace; "homologado" = ensaio em clone do banco de produção aprovado; "publicado" = ativo em produção.

## FUN-01 — baseline (08/10/2026)

| Item | Estado verificado |
|---|---|
| Git | `origin/master` = `origin/main` = `f4f8f1d`. Trabalho desta entrega no branch `MaldvsTech/erp-migration-analysis-97be5f`, criado a partir de `f4f8f1d` |
| Backend em produção | Revisão `e6b306c2adb4…`, imagem `sha256:91ecc5fb…ddb4`, conferida por SSH somente leitura em 08/10 |
| Banco em produção | PostgreSQL original da VM da API. O corte para a segunda VM (`f4f8f1d`) nunca foi executado: sem marcador `.db-split-active`; túnel e container cliente do ensaio continuam ligados |
| Frontend em produção | Último deploy registrado: `dpl_Em78qKzfF69TaVCn9Fp1agMG63gh`, revisão `6d95713`. A integração Git da Vercel não registra deploy automático desde 28/07 |
| Memória da VM | 954 MiB; ~666 MiB usados + ~400 MiB de swap; `dockerd` sozinho ocupa ~144 MiB, PostgreSQL ~16 MiB |

### Divergências entre documentos, código e ambiente

1. `ANEXO_CTO_INFRA_E_MATEMATICA` afirma ANA-01/02 como `xfail`; o teste já passa sem marcação desde `f59f245`.
2. `AUDITORIA_MIGRACAO_ERP` listava 9 defeitos abertos; ERP-02/03 já estavam corrigidos em `6759444`/`de6721f`.
3. `split-database.py` (corte do banco): o smoke faz login e o login grava `Auditoria`; a comparação de contagens reprovaria todo corte e a tentativa seguinte seria recusada. Não executar sem corrigir.
4. `compose.db-private.yml` não corresponde ao container criado manualmente na VM privada.
5. Telas do app do vendedor dependiam de dados inexistentes: catálogo lia `estoque_atual` (todo produto "Esgotado"), aprovação lia `pedidos` de um endpoint que não os devolve e exibia pedido fictício; rejeição chamava rota inexistente.

## Sprint 1 — integridade financeira e analítica

Objetivo: impedir baixas inválidas, eliminar indicadores inventados e ter release rastreável. **Concluída e publicada em 07/10** (trabalho anterior), reverificada em 08/10.

| História | Aceite | Estado | Evidência |
|---|---|---|---|
| FUN-01 | Baseline e separação das mudanças | Concluído | Esta seção |
| ANA-01/02 | Sem histórico não há previsão; sem pares não há correlação | Publicado (`f59f245`) | `test_analytics_acceptance_audit.py` 2/2 sem xfail |
| FIN-01 | 40 aceita 10+30; rejeita negativo/NaN/excedente; idempotente; concorrência PostgreSQL | Publicado (`6759444`, `de6721f`) | `test_fin01_boleto_payments.py`, `test_finance_postgres_concurrency.py`; CI PostgreSQL run 37715828015 |
| SUP-01 | Resposta válida em todos os caminhos, filtros e isolamento; causa raiz | Publicado (`d9a1f98`, `0bc1c85`, `e6b306c`) | Causa: sentinela `all` usada em coluna inteira. [Incidente](INCIDENTE_SENTRY_FORNECEDORES_2026-10-07.md) |

## Sprint 2 — integridade de estoque, compras, venda e app do vendedor

Objetivo: o mesmo saldo, custo e dinheiro em PDV, venda direta, SFA, entrega e compras. Estado geral: **backend publicado em produção em 08/10/2026; frontend pendente de publicação na Vercel** (ver "Publicação").

| História | Comportamento anterior | Comportamento corrigido |
|---|---|---|
| EST-01 (ERP-05/06/09) | Entrega não baixava estoque; SFA baixava agregado sem lote; PDV não gravava custo; cancelamento devolvia o que não saiu | `estoque_service.registrar_saida`/`estornar_saidas_venda` usados por todos os canais; custo histórico em todo item; estorno pelo razão de movimentos, uma vez |
| VAL-01 (ERP-08) | Lote vencido elegível para venda | Quarentena para produto com controle de validade; descarte consome vencido primeiro; validade real obrigatória no recebimento de produto controlado |
| COM-01 (ERP-01) | Recebimento parcial encerrava o pedido; título sobrescrito pelo bruto recebido | Recebimento acumulativo até `recebido`; título = total − (falta + avaria) preservando baixas; lote único por carga; trava por pedido |
| CUS-01 (ERP-07) | `int()` truncava fração no custo médio, compra, XML e cadastro | Decimal de ponta a ponta; custo com 4 casas; frete/desconto rateados por valor; bonificação dilui custo |
| VEN-01 (ERP-04) | SFA gravava totais enviados pelo app | Servidor recalcula; piso de preço = tabela do cliente ou 90% do preço de venda (mesma regra do app) |
| Entrega | Totais do cliente, caixa de qualquer operador, produto ausente ignorado, fiado sem título | Validações do PDV; dinheiro exige caixa aberto do operador; fiado gera título e consome crédito |
| SFA-SYNC | Custo enviado ao celular; teto silencioso de 500 produtos/100 clientes | Sync sem custo e paginado por cursor; `/produtos` oculta custo/margem/lucro para vendedor e entregador |
| SFA-APR | Fila de aprovação sempre vazia, pedido fictício, rejeição inexistente | `/sfa/pedidos` devolve a fila da loja com itens para gerente; `POST /sfa/pedidos/<id>/rejeitar`; fila offline do app passou a ser enviada |

Decisões de negócio tomadas na implementação (revisáveis pelo responsável): quarentena de vencidos; dinheiro na entrega exige caixa; piso SFA igual ao app; produto criado por XML sem controle de validade.

Testes: `test_erp_migration_audit.py` (9), `test_erp_integridade_canais.py` (22), `test_sfa_sync_custo_escala.py` (4), `test_postgres_erp_concurrency.py` (3, só PostgreSQL). Suíte local SQLite: **320 passed, 14 skipped** (skips = PostgreSQL). TypeScript: `tsc --noEmit` sem erros. Fluxo de recebimento parcial verificado no navegador com banco descartável.

Limitações conhecidas: concorrência PostgreSQL não executada localmente (sem servidor/Docker); validade continua obrigatória no modelo de lote; XML de entrada ainda não se vincula ao pedido de compra.

## Publicação da Sprint 2 (08/10/2026)

| Item | Resultado |
|---|---|
| Git | Commits `228154f`, `2a4bbaf`, `6b90a47`, `bb1974b`; `origin/main` = `origin/master` = `bb1974b2423f`; PR #4 |
| CI | Run 37729296897 aprovado: Frontend (tsc + Vite), Segurança do corte, Backend (SQLite + PostgreSQL 15) |
| Ensaio | Clone do banco de produção: smoke autenticado nos escopos global, loja 2 e loja 3; contagens preservadas (5 estabelecimentos, 37 funcionários, 133 produtos, 2.834 vendas, 114 contas a pagar) |
| Backend em produção | Imagem `mercadinhosys-backend:bb1974b2423f` (`sha256:49be5141…3607`), `healthy`; label de revisão confere; Alembic permanece em `f5d7b9c1e3a6` (sem migração) |
| Backup | Dump validado em `/home/ubuntu/mercadinhosys-releases/bb1974b2423f/database-before.dump` (1,6 MB) |
| Rollback | `python3 /home/ubuntu/mercadinhosys-releases/bb1974b2423f/infra/oracle/release.py rollback --release bb1974b2423f` (volta para `sha256:91ecc5fb…ddb4`, preserva banco) |
| Frontend (Vercel) | **Não publicado.** O bundle no ar não contém o código novo. O projeto não tem repositório Git conectado (`linkedProjects` vazio), por isso nada publica ao dar push; o conector usado nesta sessão retorna 403 para deploy de produção |

**Risco enquanto o frontend não é publicado:** a tela antiga de recebimento permite receber menos que o pedido; o pedido passa a `parcial` e a tela antiga só mostra o botão "Receber" para `pendente`. Até a publicação, não registrar recebimento parcial pela interface. O catálogo do vendedor (tela antiga) exibe custo R$ 0,00 porque o servidor passou a omitir o custo.

## Lote de correção D-01 a D-14 (08/10/2026)

Os 14 defeitos do parecer foram corrigidos de uma vez, com varredura de todos os pontos afetados e teste para cada um. Suíte do backend: **422 passaram, 14 pulados** (os pulados exigem PostgreSQL e rodam no CI); 102 testes novos neste lote. Frontend: `tsc` sem erro e build de produção.

| ID | O que mudou | Onde | Prova |
|---|---|---|---|
| D-01 | Importação de clientes reescrita: PF e PJ pelo tamanho do documento, saldo inicial vira título (`saldo_inicial`), cada linha em savepoint, 422 se nada entrou, aceita `;`/`,`, UTF-8/Latin-1, `1.234,56` e `R$` | `routes/clientes.py` | `test_clientes_pj_credito.py` (4 testes de importação) |
| D-02 | Baixa de fiado em `Decimal`, valor finito e positivo, cliente e títulos travados, saldo reconciliado com os títulos, score recalculado | `routes/clientes.py` | NaN, infinito, negativo, zero, texto e nulo recusados sem tocar na dívida; FIFO |
| D-03 | Cliente com título vencido além de 5 dias não compra a prazo (PDV e aprovação SFA); à vista continua liberado | `services/credito_service.py`, `utils/checkout_locking.py`, `routes/sfa.py` | PDV e SFA bloqueiam e liberam |
| D-04 | Score de crédito 0–1000 explicável (pontualidade, atraso médio, vencidos, relacionamento), gravado a cada baixa e importação; endpoint `GET /clientes/<id>/credito` | `services/credito_service.py` | Sem histórico = 500 neutro, nunca "bom pagador" |
| D-05 | Pedido SFA à vista não é barrado por limite nem por atraso; a prazo exige cliente em dia e limite | `routes/sfa.py` | 5 testes |
| D-06 | CMV com uma só definição (`custo_unitario` da venda; custo atual só para item legado) em dashboard, métricas e relatórios | `utils/custo.py` | Custo sobe depois da venda e o CMV não muda |
| D-07 | DRE com impostos sobre vendas (alíquota efetiva configurável), receita líquida e aviso quando não configurada | `routes/despesas.py`, `routes/configuracao.py`, tela Fiscal | Teste de DRE com e sem alíquota; validação 0–100 |
| D-08 | Tabelas de INSS e IRRF por competência (2024, 2025, 2026), dedução simplificada ou INSS + dependentes, redução da Lei 15.270/2025; holerite e rescisão usam a mesma tabela | `services/tabelas_folha.py`, `services/rh_calculator_service.py` | `test_folha_tabelas_legais.py`: 21 testes com valores de referência |
| D-09 | Rota `/ponto/teste/limpar-hoje` e o botão morto removidos | `routes/ponto.py`, `PontoPage.tsx` | A rota não existe mais |
| D-10 | NFC-e com data no fuso real do emitente (por UF) e destinatário (CPF/CNPJ válido) | `services/fiscal/emissao_service.py`, `utils/timezone.py` | Payload por UF e por tipo de pessoa |
| D-11 | Meta do vendedor conta só pedido faturado, no mês local e por intervalo (sem `EXTRACT`); pendente aparece à parte | `routes/sfa.py` | Fronteira do mês e do status testadas |
| D-12 | Fluxo de caixa sem dupla contagem de fiado e sem troco; entrada esperada = venda à vista + títulos a receber da semana | `dashboard_cientifico/data_layer.py`, `routes/despesas.py` | 5 testes |
| D-13 | Nota do fornecedor: amostra mínima de 3 entregas, fill rate, atraso só dos atrasados, parcial só conta se vencido, sem data inventada; **GET não grava mais**; atualiza no recebimento | `services/fornecedor_score.py` | `test_nfce_kpi_fornecedor_cmv.py`: nota, GET sem gravar, recebimento, relatório |
| D-14 | Desconto de vale-transporte limitado ao VT concedido | `rh_calculator_service.py` | 2 casos |

### Defeitos encontrados durante a varredura (também corrigidos)

| Achado | Gravidade | Correção |
|---|---|---|
| Busca de vendas por cliente ou funcionário sem JOIN (produto cartesiano): a venda aparecia se **qualquer** cliente de **qualquer loja** batesse com o termo | **Segurança** (vazamento de existência entre lojas) e resultado errado | JOIN explícito em `aplicar_filtros_avancados_vendas` |
| Busca por CPF/CNPJ não achava digitando só números (o documento é gravado formatado) | Funcional | `documento_contem` em clientes, busca e vendas |
| Vendedor externo via a base inteira de clientes, com saldos, e podia exportar, cobrar e editar crédito | **Comercial/LGPD** | Escopo de carteira por rota; só lista, busca, ficha, crédito e cadastro; novo cliente nasce sem limite |
| Cliente cadastrado pelo vendedor não entrava na rota dele (sumia do app) | Funcional | Entra na rota do vendedor |
| Cadastro de cliente no app do vendedor enviava campos errados e falhava sempre | Funcional | Payload corrigido, CPF/CNPJ pelo tamanho, mostra o erro do servidor |
| Carteira do vendedor mostrava só a primeira página (50) | Funcional | Percorre todas as páginas |
| Relatório de fornecedores ignorava pedido "recebido" (só contava "concluido") e mostrava OTD 100% sem dados | Dado errado | Mesmo critério da nota; sem amostra mostra "—" |
| LGPD: todo cliente anonimizado recebia o mesmo CPF e quebrava a unicidade; PJ e motoristas ficavam de fora | Conformidade | Documento único por registro; PJ e motorista inativo anonimizados |

### Limites conhecidos (não escondidos)

- **PostgreSQL não existe nesta máquina.** A concorrência de baixa de fiado e a migração em PostgreSQL só são provadas no CI e no ensaio do `release.py` (clone do banco de produção).
- **IRRF da rescisão não é calculado** (só INSS). Falta definir com a contabilidade o tratamento de aviso, 13º e férias.
- **Tabelas 2024 e 2025** vieram do sistema anterior e não foram reconferidas; a de 2026 foi conferida na fonte oficial em 08/10/2026. Competências antigas só devem ser recalculadas com a contabilidade.
- **Alíquota de impostos do DRE é uma taxa efetiva única**, não um motor de apuração. O regime tributário (decisão pendente do dono) define a matriz real.
- **Destinatário na NFC-e** usa os campos `cpf_destinatario`, `cnpj_destinatario` e `nome_destinatario` do gateway; falta homologar com token real.
- **Fuso por estado** usa o offset fixo da UF. Exceções: oeste do Amazonas (UTC-5) e Fernando de Noronha (UTC-2).
- **Nota de fornecedor:** pesos (40% pontualidade, 15% atraso, 25% fill rate, 20% condições comerciais) são uma proposta; ajustar com dados reais do piloto.

## Próximas histórias

1. **PED-01** — reserva → separação → expedição → entrega parcial.
2. **COM-02** — vincular XML ao pedido/recebimento para não duplicar estoque e título.
3. Entrega: máquina de estados e acerto do pagamento "na entrega".
4. Pós-venda: chamado, devolução parcial por lote, troca.
5. CX comercial: campanha rastreada com consentimento e comissão de vendedor.
6. NF-e modelo 55, depósitos e inventário, conciliação bancária.
