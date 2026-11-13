# Plano: venda de bebida por dose (garrafa aberta, dashboard e Consultor IA)

Status: escopo para aprovação. Nada implementado. Data: 2026-11-12.

## 1. Regra de negócio

A garrafa (ou barril) é o item de estoque. A **dose é uma forma de vender essa garrafa**, com volume em ml e
preço que o próprio lojista define. Nada de dose fixa no sistema: o lojista cria quantas doses quiser por produto
(30 ml, 51 ml, 100 ml, "dose dupla", "meia dose", "taça 150 ml") e pode ter doses padrão da loja como atalho.

Invariantes que o sistema precisa garantir:

1. Estoque, compra, nota de entrada, inventário e fiscal continuam em garrafas. Dose nunca cria estoque próprio.
2. A primeira dose de um produto **abre uma garrafa**: baixa 1 unidade do estoque (FIFO, lote, validade,
   reserva e quarentena como qualquer saída) e cria um saldo em ml. As doses seguintes consomem esse saldo.
3. Dose que não cabe no saldo atravessa garrafas: usa o que resta e abre a próxima (o balconista faz isso na vida real).
4. Todo ml tem destino registrado: venda, estorno, perda/derramamento, cortesia, degustação, ajuste de contagem,
   descarte por validade. Saldo da garrafa = soma do razão de ml (invariante testável).
5. Cancelamento de venda devolve **ml ao saldo**, nunca uma garrafa inteira ao estoque (a garrafa física continua aberta).
6. Cada item vendido guarda o retrato da dose (nome, ml, preço, custo/ml) no momento da venda. Mudar a dose depois não reescreve o histórico.
7. Custo da dose = custo da garrafa no momento da abertura ÷ ml da garrafa × ml da dose. Custo estimado continua marcado como estimado.

## 2. Estado atual do código (verificado)

| Fato | Onde |
|---|---|
| Nenhuma lógica de dose existe | busca por dose/fração em `models.py`, `pdv.py`, `vendas.py`, `estoque_service.py` |
| Quantidade fracionada suportada | `Produto.quantidade`, `VendaItem.quantidade`: `Numeric(10,3)` |
| Caminho único de baixa | `estoque_service.registrar_saida` (FIFO, quarentena, reserva, rastro em `MovimentacaoEstoque.observacoes`) |
| Estorno lê o razão | `estoque_service.estornar_saidas_venda` devolve exatamente o que o movimento tirou |
| Conversão ml↔L | `producao_service.converter` |
| Bebida tem `peso_volume` só como texto livre | `catalogo_familias.py` (família `bebida`) |
| Flag +18 já existe | atributo `alcoolica` |
| Venda é criada em 3 rotas | `pdv.py:1111`, `vendas.py:904`, `delivery.py:797` |
| Cancelamento | `vendas.py:1287` → `estornar_saidas_venda` |
| PDV trata L/ML como granel (pede peso) | `PDVPage.tsx:470`, `PesoInputModal.tsx` |
| PDV tem catálogo offline | `features/pdv/offlineCatalog.ts` |
| Consultor: um builder por especialista, cache de 5 min, evidência por RAG | `services/consultor/contextos/*`, `rag.py`, `routes/consultor.py` |
| Ações do Consultor são whitelist confirmável | `acoes.py` (`ACOES_WHITELIST`) |
| Resumo diário é determinístico (sem LLM) | `resumo_diario.py` |
| Dashboard BI soma `VendaItem.quantidade` por produto e divide `estoque / vmd` | `dashboard_bi.py:137,203` |
| `sum(VendaItem.quantidade)` aparece em ~111 pontos, 23 arquivos | giro, ABC, BI, clientes, relatórios, consultor |

### 2.1 Resultado do WP0 (verificado em 2026-11-12)

| Dúvida | Achado | Consequência |
|---|---|---|
| DRE/dashboards leem saída de estoque como perda? | Não. O CMV vem de `VendaItem.custo_unitario x quantidade`. Leitores de `MovimentacaoEstoque` por motivo: `contagem.py` ("Contagem cíclica"), descarte em `produtos.py:5353` ("descarte") e rastreio de recall em `producao_service.py:776` (`venda_id` não nulo) | A abertura de garrafa (sem `venda_id`, motivo "Abertura de garrafa (dose)") não vira perda nem venda em nenhum relatório atual |
| Perda/desvio em ml entra no DRE? | Não entra sozinha: nenhum relatório lê perda do razão de estoque | WP6 precisa levar perda, cortesia, degustação e desvio (custo em R$ do razão de ml) ao DRE como perda, senão o custo da garrafa só aparece pelas doses vendidas |
| Estoque valorizado | `Produto.quantidade` já desconta a garrafa aberta | O valor do saldo aberto precisa aparecer à parte no card e no dashboard (WP5/WP6) |
| Sync do PDV offline | Reenvia o mesmo POST de finalizar venda com `offline_uuid` (idempotente); catálogo vem de `/pdv/catalogo-offline` | A garrafa é resolvida no servidor na sincronização; o catálogo offline só precisa levar as doses (WP4) |
| Cancelamento | `estornar_saidas_venda` lê só movimentos com `venda_id`; a abertura não tem | Estorno de dose usa o razão de ml (`estornar_doses_venda`) e não toca a garrafa inteira |
| Permissão para configurar | `@permission_required('produtos')` no cadastro | Rotas de dose usam a mesma permissão; perda/ajuste/descarte com `politica_acoes.validar_pin` (usado no cancelamento de venda) |
| Comanda/mesa | Não existe módulo | Fora do escopo; dose funciona no PDV de balcão |

Ainda não verificado: execução da migration em PostgreSQL (validada em SQLite: downgrade remove, upgrade recria igual aos modelos, repetível).

## 3. Modelo de dados

Migration Alembic nova em `backend/migrations/versions`, aditiva, reversível, com `server_default` (histórico de schema drift em produção).

**`produtos`** (colunas novas, todas anuláveis):
`vende_por_dose` bool, `volume_embalagem_ml` Numeric(10,2), `validade_aberta_dias` int, `perda_esperada_pct` Numeric(5,2) (vazio herda da loja).

**`produto_doses`** (a apresentação que o lojista configura):
`id, estabelecimento_id, produto_id, nome, volume_ml Numeric(10,2) > 0, preco_venda Numeric(19,4), padrao bool, ativa bool, ordem int`.
Não se apaga dose já vendida: desativa.

**`garrafas_abertas`**:
`id, estabelecimento_id, produto_id, lote_id, volume_inicial_ml, saldo_ml Numeric(12,2), custo_garrafa (retrato), aberta_em, aberta_por,
validade_aberta date, status (aberta|vazia|descartada), movimento_abertura_id`.
Índice (estabelecimento_id, produto_id, status). Linha travada com `with_for_update` junto do produto.

**`dose_movimentos`** (razão de ml):
`id, estabelecimento_id, garrafa_id, produto_id, tipo (abertura|venda|estorno|perda|cortesia|degustacao|ajuste|descarte|desvio),
ml (com sinal), custo (R$ do ml), dose_id, venda_id, venda_item_id, estorno_de_id (único: um estorno por venda), funcionario_id, motivo, created_at`.
`saldo_ml` da garrafa = soma de `ml` (a abertura entra com +volume).

**`venda_itens`** (colunas novas): `dose_id, dose_nome, dose_volume_ml (retrato), ml_total, qtd_base Numeric(14,6)`.
`quantidade` = número de doses (preço × quantidade = total do item continua valendo); `produto_unidade = "DOSE"`;
`qtd_base` = garrafas equivalentes (ml_total ÷ volume da garrafa).

**`configuracoes`** (loja): `doses_padrao` (lista de ml, ex.: 50, 100), `margem_alvo_dose_pct`, `perda_esperada_pct`,
`alerta_garrafa_aberta_dias`, `alerta_rendimento_pct`.

Decisão de projeto: o movimento de **abertura** da garrafa é uma saída de estoque comum, mas **sem `venda_id`** e marcada
(`observacoes.abertura_dose`). Assim o cancelamento de venda nunca "devolve" uma garrafa que está aberta no balcão.

## 4. Backend

### 4.1 Núcleo: `services/dose_service.py` (novo)

- `abrir_garrafa(produto, ...)`: chama `estoque_service.registrar_saida(produto, 1, ...)`, cria `GarrafaAberta`, grava o rastro do lote (recall funciona).
- `vender_dose(produto, dose, quantidade, venda, funcionario)`: consome ml da garrafa aberta mais antiga; atravessa garrafas; abre quando preciso; grava `dose_movimentos`; devolve `custo_por_dose`, `ml_total`, `qtd_base`.
- `estornar_doses_venda(venda)`: devolve ml à garrafa de origem (reabre se estava vazia); idempotente.
- `registrar_perda_ml`, `registrar_cortesia`, `encerrar_garrafa` ("terminou"; o ml que o razão ainda mostrava vira desvio/quebra), `ajustar_contagem` (contagem física em ml), `descartar_vencida`.
- `rendimento(estab, periodo)`: doses/ml por garrafa encerrada vs esperado.
- Venda sem estoque (config da loja `permitir_venda_sem_estoque`) segue a regra existente de `registrar_saida`.

### 4.2 Pontos de integração (varredura completa)

| Ponto | Mudança |
|---|---|
| `pdv.py` checkout | item com `dose_id` chama `vender_dose`; custo, margem e `quantidade_vendida` pela base |
| `vendas.py` (criação e cancelamento) | idem; cancelar chama `estornar_doses_venda` além de `estornar_saidas_venda` (que ignora a abertura) |
| `delivery.py` | idem |
| `estoque_service.estornar_saidas_venda` | pular movimento de abertura |
| Sync do PDV offline | item offline leva `dose_id`; servidor resolve a garrafa na sincronização |
| `Produto.quantidade_vendida`, `giro_cache`, ABC | usar `qtd_base` |
| Contagem cíclica | contar garrafas fechadas + ml da aberta |
| Descarte/vencimento | garrafa aberta vence por `validade_aberta` |
| Etiquetas e vitrine pública | opcional na Fase 3 (preço da dose no cardápio) |

**Risco já mapeado:** `VendaItem.quantidade` passa a significar doses. Todo consumidor que divide estoque por venda
(`cobertura = estoque / vmd`, reposição, ABC por unidade) erraria por um fator de ~20.
Solução: `VendaItem.quantidade_base` (hybrid_property = `coalesce(qtd_base, quantidade)`) e um teste que **falha** se aparecer
`sum(VendaItem.quantidade)` fora de uma lista aprovada. Os ~111 pontos são revisados um a um (receita fica como está, unidades viram base).

### 4.2.1 Resultado do WP2 (feito em 2026-11-12)

- **Contrato do item:** o carrinho leva `dose_id` no item (junto de `id`, `quantity` e `price`). Sem `dose_id` é venda comum, sem mudança.
- **Ponto único:** `dose_service.baixar_item(...)` é chamado pelo PDV (`pdv.py`), pela venda direta (`vendas.py`) e pela entrega (`delivery.py`); devolve o custo por dose e as colunas do `VendaItem`.
- **Conferência de preço (`checkout_locking`):** `normalizar_itens_checkout` valida o `dose_id`; `validate_pricing` usa o preço da DOSE como referência do limite de desconto (sem isso, uma dose de R$ 18 pareceria 88% de desconto sobre a garrafa de R$ 150 e o caixa seria barrado).
- **Cancelamento:** `estornar_doses_venda` devolve ml; item de dose sai de `legado` (senão o estorno somaria 2 "unidades" de dose ao estoque) e de `registrar_perda_de_venda` (perda de dose é em ml e vira `perda` no razão).
- **Contador de vendidos:** `Produto.quantidade_vendida` passou a `Numeric(14,6)` e soma garrafas equivalentes. Com 3 casas, 50 ml de 750 ml (0,066667) acumularia erro e a verificação de dados acusaria divergência falsa.
- **Varredura:** 29 somas por produto passaram de `VendaItem.quantidade` para `VendaItem.quantidade_base` (giro, BI, categorias, ranking, clientes, relatórios, Consultor, backfill, verificação de dados, SFA). Ficaram como estavam, por contarem itens passados no caixa: estatísticas de `vendas.py` (2), "itens" do comparativo (1) e "produtos passados" do RH (1). Custo e receita (`custo_unitario x quantidade`, `preco_unitario x quantidade`) já estavam certos em doses.
- **Guarda:** `tests/test_dose_guarda_somas.py` falha se surgir soma bruta nova fora da lista aprovada.
- **Recall:** `rastreio_lote` inclui as vendas por dose do lote (via garrafas abertas daquele lote), com ml e garrafas equivalentes; venda estornada some.
- **Fiscal (aberto, WP8):** a NFC-e sai com `uCom = DOSE`, `qCom` = nº de doses e `vUnCom` = preço da dose. Não quebra a emissão, mas a classificação fiscal da dose continua sendo a decisão com o contador.
- **Ainda fora:** dose livre com PIN (preço/ml fora da tabela) e preço da dose sobrescrito no caixa ficam no WP4; o PDV de rascunho (`/vendas/pdv/ativo`) não aceita dose.

### 4.2.2 Resultado do WP3 (feito em 2026-11-12)

- **Nada de dose fixa:** cada produto guarda as doses que o lojista cadastra (`produto_doses`: nome, ml livre com decimais, preço). A loja guarda só os ml que costuma trabalhar, como atalho (`doses_padrao`); sem definir, vêm 50 e 100 ml como sugestão inicial.
- **API** (`/api/doses`): `GET/PUT /produto/<id>` (volume da garrafa + doses, devolve custo, margem e rendimento já calculados e avisos), `GET/PUT /config` (doses padrão, margem alvo, perda esperada, alertas), `POST /aplicar` (mesmo modelo em vários produtos; sem `dry_run:false` só pré-visualiza; modos substituir/acrescentar; por lista de ids ou filtro de subcategoria/categoria/marca/família).
- **Regras:** dose maior que a garrafa, ml ou preço zero, nomes repetidos entre as ativas, mais de uma padrão e mais de 12 doses são recusados. Dose já vendida nunca se apaga: é arquivada (a nova pode reusar o nome). Perda esperada (do produto, senão da loja) encarece o custo da dose. Avisos (não bloqueiam): margem negativa, margem abaixo da meta, dose com R$/ml abaixo da garrafa fechada.
- **Preço sugerido:** custo da dose ÷ (1 − margem alvo), arredondado para cima ao próximo R$ 0,50. O front espelha a conta e os testes usam os mesmos casos.
- **Segurança:** escrever dose usa a política `produtos.editar` ("Editar produto e preço", padrão admin e gerente, configurável pelo dono), não o RBAC genérico de produtos. O teste de permissão pegou que esse RBAC deixava o caixa mudar o preço de uma dose para R$ 1. Padrões da loja: só gerente/admin. Nada cruza lojas (testado).
- **Front:** seção "Venda por dose" no cadastro de bebida (`DosesEditor`: volume com atalhos e detecção pelo nome, linhas de dose com nome, ml, preço e margem editáveis nos dois sentidos, resumo "garrafa rende R$ X", avisos); aba Estoque das Configurações com padrões da loja e "Aplicar a vários produtos" (tipo de bebida da taxonomia real, pré-visualização antes de gravar). Verificado no navegador contra um backend descartável: configurou, salvou, a API devolveu as doses; celular a 375 px sem estouro (corrigido o cabeçalho que vazava).
- **Ainda não feito:** o PDV não mostra as doses (WP4). A seção só aparece para família Bebidas ou produto que já vende por dose.

### 4.2.3 Resultado do WP4 (feito em 2026-11-12)

- **PDV recebe as doses:** `buscar-produtos`, o bip de código de barras (`validar-produto`) e o `catalogo-offline` trazem, nos produtos que vendem por dose, `doses` (só as ativas, a padrão primeiro), `volume_embalagem_ml`, `saldo_aberto_ml` e as garrafas abertas. Nova rota `GET /api/pdv/cardapio-doses` lista o que dá para servir agora.
- **Linha do carrinho tem identidade própria** (`chave`): o mesmo produto vira garrafa, dose, dupla e dose livre ao mesmo tempo. Produto comum segue sem `chave`, então carrinho salvo no navegador continua válido. Estoque do caixa em ml: aberta + fechadas − o que as outras linhas já pegaram; dose vendida reduz quantas garrafas inteiras ainda dá para vender.
- **Folha de escolha** (`DoseSheet`): doses do lojista (ml e preço dele), garrafa inteira, "restam N", saldo da garrafa aberta ("650 ml ≈ 13 doses"), última escolha realçada, teclas 1-9/Enter/setas/Esc, "Outra quantidade (ml)" e "Terminou a garrafa". Cardápio rápido: botão "Doses" no PDV com um toque por dose.
- **Dose livre** (`dose_ml` no item): preço de referência = R$/ml da dose padrão × ml. Exige a política `doses.livre` (caixa só com PIN de gerente; o dono pode restringir ou liberar). O servidor responde `403 PIN_REQUIRED` e o app já existente pede o PIN e refaz a venda: nenhuma tela nova de PIN. Caixa sem desconto não cobra menos que a referência. Fica fora do modo offline (para não guardar PIN na fila local).
- **Fim de garrafa:** `POST /api/doses/garrafas/<id>/encerrar` (política `doses.encerrar`, caixa pode) grava o desvio e devolve o resumo (vendido, perdas, desvio, rendimento). `GET /api/doses/garrafas-abertas`.
- **Cupom:** o item sai como "WHISKY 1L - Dose (50 ml)" / "Dose livre (45 ml)", no cupom do servidor e na cópia local.
- **Marcador do item de dose:** `VendaItem.eh_dose` (ml_total preenchido), não `dose_id`: a dose livre não tem `dose_id`. Cancelamento e perda usam o marcador.
- **Regra nova:** dose maior que a garrafa é recusada na venda (antes só no cadastro): garrafa trocada por menor ou ml digitado errado.
- **Dois bugs achados só no navegador:** a busca do PDV retomava o foco 50 ms depois do clique e engolia as teclas da folha (corrigido nos dois lados); cabeçalho das configurações vazava no celular (WP3).
- **Verificado no navegador** (backend descartável): busca → folha → tecla 1 → linha "DOSE · 50 ML R$ 18,00/dose"; cardápio com um toque; dose livre de 45 ml; troco calculado; PIN pedido ao caixa; venda gravada (1 garrafa aberta com 805 ml, 4 fechadas, cupom com os nomes); "Terminou a garrafa" encerrou e avisou o desvio; folha a 375 px sem estouro.
- **Fora do WP4:** a folha e o cardápio não mostram "perda/cortesia/degustação" (WP5); o PDV de rascunho (`/vendas/pdv/ativo`) segue sem dose; NFC-e da dose continua pendente da decisão fiscal (WP8).

### 4.2.4 Resultado do WP5 (feito em 2026-11-12)

- **Card de estoque:** a lista de produtos (tabela e card do celular) mostra, para bebida que vende por dose, "4 UN + 1 aberta · 850 ml ≈ 17 doses" (e "vencida depois de aberta" quando é o caso). O refrigerante não ganha nada. O servidor manda `produto.dose` na lista (uma consulta por página) e no hub do produto (`dose_service.resumo_aberto`).
- **Painel "Venda por dose" no hub do produto** (`DosesPainel`): garrafas abertas (saldo, barra, idade, aviso de vencida), **Contei a garrafa** (ajuste por contagem), **Terminou**, **Descartar**, **Registrar saída de ml** (perda/derramou, cortesia, degustação) e o razão de ml (quando, o quê, ml, dose/venda, quem, custo).
- **Rotas:** `POST /api/doses/produto/<id>/baixa`, `POST /garrafas/<id>/ajuste`, `POST /garrafas/<id>/descartar`, `GET /garrafas/<id>` (resumo + razão + confere), `GET /produto/<id>/razao`, `GET /vencidas`.
- **Quem pode** (política de ações da loja, o dono ajusta em Configurações → Permissões): `doses.baixa`, `doses.ajustar` e `doses.descartar` valem para gerente/admin e para o caixa **só com o PIN de gerente** (o app já pede o PIN sozinho); `doses.encerrar` o caixa faz sem PIN. O razão guarda quem executou, não quem deu o PIN. Perda exige dizer o que aconteceu.
- **Contagem cíclica:** o bip conta as garrafas fechadas (o esperado já exclui a aberta, então bate). `conferir` agora devolve as garrafas abertas dos produtos contados e a tela mostra o bloco "Garrafas abertas: conte em ml" com o campo e o botão Registrar (ajuste por contagem). Não mudou o banco da contagem.
- **Validade depois de aberta:** garrafa vencida sai do saldo vendável e do cardápio, aparece em `/vencidas` e no painel, e espera o descarte.
- **Verificado no navegador:** lista com a aberta; hub com o painel; perda de 40 ml (R$ 4,80) e contagem (770 ml, diferença −40 ml) gravadas no razão; contagem cíclica de ponta a ponta; celular a 375 px sem estouro. Bug achado e corrigido: formulário de saída de ml cortava o botão em largura média.
- **Ainda não (feito no WP6, ver 4.2.5):** custo de perda no DRE, dashboard de doses, alertas e cobertura em doses.

#### 4.2.5 WP6 enxuto: o que foi feito (2026-11-13)

- **Fonte única:** `services/dose_metricas.py` (`metricas`, `custo_perdas`, `alertas_da_loja`). Dashboard, DRE e alertas leem dali.
- **Rotas:** `GET /api/dashboard/doses` (gerente, plano Pro; `de/ate` ou `days`; `formato=csv` exporta a tabela por produto, com proteção contra fórmula de planilha) e alertas de dose dentro de `GET /api/dashboard/alertas` (`tipo: "dose"`, aparecem no painel "Alertas Operacionais").
- **Aba Doses** no dashboard: doses, ml, receita, custo, margem e margem depois das perdas; rendimento das garrafas encerradas; perdas por tipo e por funcionário; doses por hora; garrafas abertas (idade, valor, vencida); tabela por produto com R$/garrafa em dose × preço da garrafa fechada, desvio e cobertura em dias e em doses.
- **DRE:** `dre_consolidado.perdas_estoque_dose` (custo em R$ de perda, cortesia, degustação, descarte e diferença ao encerrar; ajuste negativo conta, positivo abate) desconta do lucro líquido; o CMV não muda. Aparece no DRE da tela de Relatórios e na exportação.
- **Alertas** só do que o lojista pediu para vigiar: garrafa aberta velha (`alerta_garrafa_aberta_dias`), vencida, rendimento abaixo de `alerta_rendimento_pct`, margem da dose abaixo de `margem_alvo_dose_pct`; aviso de uso quando nenhuma garrafa foi encerrada.
- **Rendimento** = ml vendido líquido ÷ volume das garrafas encerradas no período (só a garrafa que terminou mostra o desvio).
- **Fora desta entrega:** relatório de dose em página própria (a aba exporta CSV), resumo diário e Consultor IA (WP7), `lucro_liquido` do dashboard científico (`orchestration.py`) ainda não desconta a perda de dose.
- **Testes:** `tests/test_dose_metricas.py` (12), `DosesTab.test.tsx` (5); guarda de somas atualizada com as 2 somas aprovadas de `dose_metricas`. Verificado no navegador (demo descartável) em desktop e 375 px.

### 4.3 Rotas novas (`routes/doses.py`, blueprint próprio)

- `GET/PUT /api/produtos/<id>/doses`: lista e salva doses (gerente). Valida ml > 0, preço > 0, uma `padrao`, aviso se preço/ml da dose < preço/ml da garrafa.
- `POST /api/produtos/doses/aplicar`: aplica um modelo de doses a uma seleção (subcategoria, marca) com pré-visualização.
- `GET /api/doses/garrafas-abertas`: saldo, idade, dose equivalente restante.
- `POST /api/doses/garrafas/<id>/perda|cortesia|encerrar|ajuste|descartar`: perda e ajuste exigem PIN de gerente (padrão já usado em estorno/descarte).
- `GET /api/dashboard/doses` e `GET /api/relatorios/doses` (+ exportação).
- Tudo por `TenantQuery`/`estabelecimento_id`; auditoria em `Auditoria`; sem segredo em log.

## 5. UX / UI

### 5.1 Cadastro: "Doses" no produto (aba/seção em `ProductFormModal`)

- Aparece para família bebida (e qualquer produto com `unidade L/ml`, como cachaça a granel, barril): liga "Vende por dose".
- Pede o **volume da garrafa** (pré-preenchido a partir de `peso_volume`/nome: "1L", "750ml"; usuário confirma).
- Editor de linhas `[nome] [ml] [preço] [margem] [doses/garrafa]`:
  - ml livre (qualquer número), com atalhos (30, 50, 60, 100) vindos das doses padrão da loja;
  - preço ↔ margem em dupla via: digitou o preço, mostra a margem; digitou a margem alvo, sugere o preço (com arredondamento comercial, ex. x,90);
  - resumo vivo: "garrafa R$ 120 → 20 doses → R$ 360 (3,0×). Custo R$ 6,00/dose";
  - alerta vermelho se a dose dá margem menor que a garrafa fechada ou abaixo da meta da loja;
  - "copiar de outro produto" e "aplicar a todos de Whisky" com pré-visualização.
- Doses padrão da loja em Configurações (a lista de ml que o dono "trabalha").

### 5.2 PDV

- Produto com dose: ao tocar/bipar abre uma folha com botões grandes `Garrafa R$ 120 | Dose 50 ml R$ 18 | Dupla 100 ml R$ 32`; a última escolha fica lembrada.
- **Dose livre** (digita ml, preço proporcional ao preço/ml da dose padrão): só com permissão ou PIN, para o caso fora da tabela.
- Filtro/aba "Doses" com o cardápio de bar (tiles com preço da dose) para venda rápida.
- Carrinho: "2× Dose 50 ml · Whisky 1L".
- Indicador discreto "garrafa aberta: 650 ml" e botão "Terminou a garrafa" (um toque).
- Cupom e NFC-e mostram "DOSE 50ML ..." (regra fiscal na seção 9).
- Catálogo offline leva doses e saldo estimado.

### 5.3 Estoque

- Card/lista: "7 fechadas + 1 aberta (650 ml ≈ 13 doses)".
- Detalhe do produto: aba Doses (garrafas abertas, razão de ml, rendimento por garrafa).
- Ações: perda/derramamento em ml (PIN), cortesia, ajuste por contagem, descartar vencida.

### 5.4 Dashboard e relatórios (acompanhamento)

Nova aba **Doses** no dashboard (junto da aba Análise BI) e relatório próprio, com filtro de período, produto, categoria, vendedor.

Indicadores:
- doses vendidas, ml vendidos, receita de doses, CMV e margem **por dose** e por produto;
- mix: dose × dupla × garrafa fechada (qual vende mais, qual dá mais lucro por garrafa);
- **rendimento**: doses/garrafa real × esperado, por produto e por funcionário/turno (identifica dose generosa ou venda sem registro);
- ml sem explicação: o que sobrou como desvio ao encerrar/contar garrafas;
- perdas, cortesias e degustações em ml e em R$, por motivo;
- garrafas abertas agora, idade, valor imobilizado aberto, risco de vencer;
- cobertura em doses (quantas doses o estoque atual rende no ritmo atual) e ponto de reposição em garrafas;
- horário/dia de pico por dose (happy hour);
- "receita potencial da garrafa": quanto a dose rende a mais que vender a garrafa fechada.

Alertas (reaproveitam `AlertsPanel`/`PainelDoDia`): garrafa aberta há mais de N dias; rendimento abaixo do limite; dose com margem abaixo da meta; produto com dose sem garrafa fechada e com aberta quase vazia.

Fonte única das contas em `services/dose_metricas.py`, consumida pelo dashboard, relatório, resumo diário e Consultor (a tela e a IA nunca discordam, regra já seguida em `resumo_diario.py`).

## 6. IA Consultora

Hoje cada especialista tem um builder determinístico; o LLM só comenta números reais. Mantemos esse princípio.

1. **Novo contexto** `contextos/doses.py` registrado em `BUILDERS` (`routes/consultor.py`): produtos com dose, margem por dose, rendimento, garrafas abertas, perdas/cortesias, desvio por funcionário, cobertura em doses. Chaves com "custo"/"margem" ficam restritas a gerente (o filtro de `rag.py` já remove essas chaves para não gerente: nomear de acordo).
2. **Roteamento**: palavras-chave em `rag.TOPICS` ("dose", "garrafa", "whisky", "rendimento", "derramou", "taça", "chope"); o `geral` passa a buscar `doses` quando a pergunta for de bar.
3. **Especialistas existentes** (`estoque`, `vendas`, `auditoria`) ganham o bloco de doses no contexto e no prompt (prevenção de perdas olha rendimento e desvio).
4. **Conhecimento do `sistema`**: "como cadastro dose", "por que minha garrafa rende menos", com passo a passo real do app.
5. **Ações confirmáveis** (whitelist, o lojista confirma): `configurar_doses` (cria doses sugeridas para um produto a partir da meta de margem), `ajustar_preco_dose` (propõe novo preço quando a margem cai), `criar_lembrete` (descartar garrafa aberta). `gerar_pedido_compra` passa a usar giro em base de garrafas.
6. **Resumo diário**: item "Doses" determinístico (doses de ontem, rendimento, garrafas abertas há muito tempo, perda em R$), prioridade quando houver desvio.
7. **Insights proativos**: rendimento caindo por funcionário, dose com margem corroída por reajuste do fornecedor, produto de dose parado.
8. **Salvaguardas**: números só do banco; texto do banco tratado como dado; custo/margem restritos a gerente; sem inventar rendimento quando a loja não encerra garrafas ("faltam dados: encerre as garrafas para medir rendimento").

## 7. Pacotes de trabalho e ordem

| # | Pacote | Entrega | Depende |
|---|---|---|---|
| WP0 | Verificações pendentes (DRE/movimentos, sync offline, permissões, comanda) | decisões fechadas | |
| WP1 | Modelo + migration + `dose_service` + testes do razão | núcleo provado por teste | WP0 |
| WP2 | Integração nas 3 rotas de venda, estorno, `quantidade_base` e varredura das ~111 somas | vendas com dose corretas em todo o sistema | WP1 |
| WP3 | Cadastro de doses (backend CRUD + `ProductFormModal`) + doses padrão da loja + aplicar em lote | lojista configura os ml | WP1 |
| WP4 | PDV (folha de escolha, dose livre, filtro Doses, carrinho, offline) | venda no balcão | WP2, WP3 |
| WP5 | Estoque: garrafa aberta, perda/cortesia/ajuste/encerrar, contagem, validade | controle físico | WP2 |
| WP6 | `dose_metricas`, aba Doses do dashboard, relatório, alertas, exportação | acompanhamento | WP2, WP5 |
| WP7 | Consultor IA (contexto, roteamento, ações, resumo, prompts) | IA aprimorada | WP6 |
| WP8 | Fiscal da dose, cardápio público, etiquetas | acabamento comercial | decisão fiscal |

WP1 e WP3 podem andar juntos depois da migration. Cada pacote fecha com testes, build do front e verificação no navegador antes do próximo.

## 8. Testes (critério de aceite)

- Razão: saldo de cada garrafa = soma de `dose_movimentos`; estoque em garrafas = razão de `MovimentacaoEstoque`.
- Dose atravessando garrafas; dose maior que o saldo; venda sem estoque configurada.
- Cancelamento devolve ml e não garrafa; cancelar duas vezes é recusado; estorno de garrafa já vazia a reabre.
- Concorrência: dois caixas vendendo da mesma garrafa (sem saldo negativo indevido, sem abrir duas garrafas à toa).
- Lote/validade: abertura respeita FIFO, quarentena, vencido; rastreio de recall inclui garrafa aberta.
- Isolamento multi-tenant: loja A nunca vê dose/garrafa da loja B.
- Cálculo: custo por dose, margem, `qtd_base`; arredondamento; ml decimais (51,5 ml).
- Guarda de regressão: nenhuma `sum(VendaItem.quantidade)` fora da lista aprovada.
- Offline: venda offline com dose sincroniza sem duplicar abertura.
- Consultor: contexto restrito para não gerente; números iguais aos do dashboard; ação confirmável grava auditoria.
- Front (vitest): editor de doses (preço↔margem), folha do PDV, card de estoque; mobile 375 px.
- `conftest` mantém segredos zerados (regra de não mandar e-mail nem gastar API em teste).

## 9. Decisões e riscos em aberto

1. **Fiscal da dose**: venda de dose em bar é, em geral, tratada como alimentação/serviço, em adega como mercadoria; muda por regime e município. Proposta: Fase 1 sem emissão específica, usando o perfil fiscal da bebida; fechar com o contador antes do WP8.
2. **Maioridade**: confirmar se o PDV já exige confirmação +18 para `alcoolica`; se não, entra no WP4.
3. **Desvio só aparece ao encerrar ou contar a garrafa.** O razão é fechado por construção; sem "Terminou a garrafa" e contagem o sistema não enxerga dose generosa. A UX do WP4/WP5 precisa tornar isso de um toque, e o dashboard avisa quando a loja não encerra garrafas.
4. **Comanda/mesa**: bar normalmente vende por comanda. Fora deste escopo; confirmar se existe e se a dose precisa funcionar nela.
5. **Chope e barril** (barril 30 L em copos de 300 ml) usam o mesmo motor; recomendo habilitar já no WP1, só trocando o vocabulário na tela.
6. **Dose editada depois** vale só daí em diante (retrato no item da venda); relatório mostra o ml usado na época.
7. **Produção em prod**: migration aditiva com `server_default`, aplicada pelo fluxo de release existente; plano de rollback é desligar `vende_por_dose` (colunas ficam).

## 10. Estratégia de execução

- Arquitetura, razão de ml, estorno, PIN, permissões, tenant e revisão final: feitos e revisados por mim.
- Volume repetitivo (CRUD de doses, tipos TS, testes parametrizados, textos do Consultor): delegado ao Ollama, revisado antes de gravar.
- Um branch e um PR (branch da sessão), commits por pacote.
- Seed/demo de dose fica local (não versionar), seguindo a regra de seeds.
