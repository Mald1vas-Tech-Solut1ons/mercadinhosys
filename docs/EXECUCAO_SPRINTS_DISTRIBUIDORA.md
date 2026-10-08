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
3. **ENT-01** — máquina de estados e acerto do pagamento "na entrega": implementação e aceites abaixo.
4. Pós-venda: chamado, devolução parcial por lote, troca.
5. CX comercial: campanha rastreada com consentimento e comissão de vendedor.
6. NF-e modelo 55, depósitos e inventário, conciliação bancária.

## Continuação ENT-01 — entrega e acerto financeiro (08/10/2026)

Continua o trabalho do lote D-01..D-14 sobre a base `1989e17`, no checkout existente. Uma confirmação repetida de entrega antes incrementava novamente o motorista; qualquer texto era aceito como status; o pagamento `entrega` ficava pendente sem processo de acerto. O portal associava funcionário a motorista pelo nome.

| Fluxo | Regra implementada | Evidência |
|---|---|---|
| Despacho | `pendente`/`em_preparo` → `em_rota`, com motorista ativo da loja e veículo da loja quando informado | API e serviço `entrega_service` |
| Confirmação | Só `em_rota` → `entregue`; repetição preserva horários, histórico, quantidades e contadores de motorista/veículo | `test_entrega_acerto.py` |
| Identidade | Entregador assume/atualiza apenas entrega correspondente ao seu CPF; portal resolve o cadastro pelo usuário autenticado | `GET /delivery/motoristas/me` e testes |
| Recebimento | Caixa/gestão registra dinheiro, Pix, cartão ou combinação; exige valor finito, centavos, cobertura do saldo e troco só em dinheiro | `POST /delivery/entregas/<id>/receber` |
| Dinheiro | Entra uma vez no caixa aberto de quem registra o acerto, descontado o troco; fechamento/baixa usam locks | Testes de acerto, caixa fechado e cancelamento da venda |
| Retentativa | Chave de operação + composição dos pagamentos; repetir a mesma operação não duplica e mudar o conteúdo com a mesma chave retorna conflito | Testes de idempotência |
| Caixa por data | Recebimento reconhecido no dia da liquidação, preservando a receita por competência da venda | Teste de venda ontem / recebimento hoje |
| Pendências | Filtro `pagamento_status=pendente`, incluindo entregas concluídas; a fila remove o acerto liquidado | Tela “Acertos pendentes” e teste da API |
| Cancelamento logístico | Exige motivo e mantém a venda/estoque/financeiro; cancelamento comercial continua no fluxo autorizado da venda | Testes separados de cancelamento logístico e estorno comercial |

Os horários da entrega são devolvidos com offset para o navegador calcular o tempo real corretamente. O saldo pendente e o estado financeiro passaram a fazer parte do retorno da entrega. A listagem carrega vendas/pagamentos em lote.

**Validação:** 30 casos novos, incluindo duas provas de concorrência exclusivas de PostgreSQL, adicionadas ao job PostgreSQL do CI. SQLite valida regras e efeitos financeiros; não comprova locks. A evidência de publicação deve identificar o commit, o run CI, o ensaio Oracle e o deployment Vercel da entrega.

**Escopo:** o acerto registra valores já recebidos; não dispara cobrança, não verifica Pix no banco e não executa cartão em adquirente. A confirmação atual é integral; entrega parcial, devolução parcial, reserva/separação/expedição (PED-01), vínculo XML/pedido (COM-02) e pós-venda continuam no backlog. Não foi criada migração de schema nem realizado seed de produção.

## COM-02A — documento XML vinculado à compra

Uma nota que cobre o pedido integral pode ser vinculada antes, durante ou depois do recebimento físico. O vínculo preserva estoque, lotes, custo, título, vencimento e baixas: não realiza outro recebimento nem gera outra obrigação. A compra continua recebendo cargas parciais no fluxo de conferência existente.

São conferidos estabelecimento destinatário, fornecedor, produtos, unidades, quantidades integrais, total e valores líquidos por produto. Pedido devolvido/cancelado, outra loja, segunda nota do mesmo pedido e chave já importada são recusados. O vínculo de um pedido é único no banco. Importações simultâneas são serializadas por estabelecimento; a prova PostgreSQL está no CI. O XML e o mapa de produtos são guardados.

A tela exige selecionar o pedido ou confirmar uma compra avulsa distinta. Se a nota já identifica um pedido, importar avulsa é recusado. Se um XML avulso já movimentou estoque, receber um pedido informando essa mesma nota é recusado para reconciliação. Vendedor e entregador não acessam a importação fiscal.

Migração expansiva `f9b2c4d6e8a0`: coluna nullable, FK e unicidade; notas legadas continuam avulsas, sem inferir vínculos ou mexer em saldo. Downgrade de schema recusa apagar vínculos ativos; voltar a imagem mantém a expansão compatível.

**Limites desta fatia:** uma NF-e por pedido integral; não aceita várias notas fiscais parciais, conversão de embalagem ou divergência de preço/tributos. Esses casos exigem outra fatia e reconciliação explícita. Duplicatas do XML não substituem o vencimento ou parcelamento contratado no pedido. Não valida autenticidade/autorização na SEFAZ. A confirmação de compra avulsa é declaração do operador: sem referência documental não é possível inferir que duas compras diferentes são a mesma operação. COM-02 completo continua aberto.

**Liberação empresarial:** ver `DECISAO_LIBERACAO_MIGRACAO_2026-10-08.md`. Não liberar migração integral ou piloto com escrita real apenas porque uma fatia foi publicada.
