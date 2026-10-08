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

## Próximas histórias

1. **B2B-01** — cliente PJ (CNPJ, razão social, IE, contatos, endereços de faturamento/entrega). Prioridade: sem isso a distribuidora não cadastra os próprios clientes.
2. **PED-01** — reserva → separação → expedição → entrega parcial.
3. **COM-02** — vincular XML ao pedido/recebimento para não duplicar estoque e título.
4. Entrega: máquina de estados e acerto do pagamento "na entrega".
