# CONTEXTO COMPLETO — Análise UX/UI do MercadinhoSys (piloto)
## Documento consolidado de uma sessão inteira: análise de código, julgamento de produto e plano de sprints

**Data:** 2026-10-31
**Natureza:** este documento é o único ponto de verdade do que a sessão produziu. Reúne, sem juntar com repetição: (a) o que foi lido no código e provado, (b) o que foi alegado e depois corrigido, (c) o que falta saber, (d) o julgamento de produto/PO, (e) o plano de 3 sprints com a decisão na mesa.

---

# PARTE A — O QUE FOI REALMENTE VERIFICADO NO CÓDIGO (e o que é palpite honesto)

## A.1 — Lido na íntegra (frontend, ~9.500 linhas)
`PDVPage.tsx` (1153), `usePDV.ts` (614), `ProdutoSearch.tsx`, `CarrinhoItem.tsx`, `MultiPaymentManager.tsx`, `ClienteSelect.tsx`, `PesoInputModal.tsx`, `CaixaManager.tsx` (636), `CaixaHeader.tsx`, `ProductFormModal.tsx` (1337), `ProductsPage.tsx` (1113), `ProductHubPage.tsx` (parcial), `LotesDisponiveisModal.tsx`, `ExpiringProductsModal.tsx` (365), `SalesPage.tsx` (674), `SettingsPage.tsx` (1410), `DashboardPage.tsx`, `Sidebar.tsx`, `BottomNavigation.tsx`, `MainLayout.tsx`, `TourExecutivo.tsx`, `BuscaGlobal.tsx`, `LoginPage.tsx`, `PurchasesPage.tsx` (parcial), `permissions.ts`, `ConfigContext.tsx`, `index.css`, `GlobalShortcuts.tsx`, `shortcuts/registry.ts`, `InsightCard.tsx`, `consultorService.ts`.

## A.2 — Auditado no backend (só onde a tela depende)
`routes/consultor.py`, `services/consultor/quota.py`, `services/consultor/rag.py`, `services/consultor/contextos/__init__.py`, `utils/query_helpers.py`, `routes/auth_multi_tenant.py`, `routes/pdv.py` (parcial), `routes/vendas.py` (parcial: cancelamento), `models.py` (chaves de config, tabela `auditoria`), `routes/caixas.py`, `routes/clientes.py:1013`, `services/catalogo_familias.py`, `services/codigo_barras_service.py`.

## A.3 — NÃO foi verificado (exposto, não escondido)
- O app **mobile** inteiro (Expo): li só o suficiente para identificar que é o app do **entregador** (geofence + WhatsApp), fora de escopo do piloto sem delivery. Não avaliei UX dele.
- O **parser de balança no PDV** (EAN `2+PLU+peso+DV`): provei que `validar_produto` busca o código **literal** (`pdv.py:576`) e não normaliza. Afirmo "não entende etiqueta de balança" com essa evidência; não descarto alguma normalização em outro ponto da cadeia que eu não vi.
- Se o backend aplica o `limite_desconto` na finalização da venda (o front ignora; o back pode segurar e eu não abri a rota inteira).
- TOTVS/Linx/CISS de verdade (o benchmark é pelo padrão conhecido do nicho, não por screenshot do concorrente).

---

# PARTE B — O QUE A SESSÃO PRODUZIU (em ordem cronológica)

Esta sessão teve 8 rodadas. Cada uma é honestamente listada — incluindo o que foi errado e corrigido depois. É o registro de como a conclusão foi construída, não o marketing de um processo perfeito.

**Rodada 1** — Auditoria inicial: PDV, configs, menu. Achados certos: switches cenário (alertas_email/whatsapp, arredondamento, exibir_preco_tela, cor_principal sem consumidor), vermelho no "Concluir Venda", sangria hardcoded R$ 500. Erros: tratei como "plano de UX" o que era lista de achados técnicos.

**Rodada 2** — Aprofundamento com acessibilidade: PDV 0 aria-*, toast sem aria-live, modais sem Esc, parser de data divergente em 3 pontos, badge de validade com 30 hardcoded.

**Rodada 3** — Caso de uso real: caixa esquecido 14h, PIX sem conferência, abertura sem âncora, multi-sessão com nome errado, desconto sem freio. **Erro cometido e corrigido:** afirmei "fiado vende sem acender nada" e "o tour sequestra o primeiro login" — ambos errados (o badge de dívida existe e é passivo, e o tour é on-demand).

**Rodada 4** — Continuei a ler o que declarei não lido: PesoInputModal (a falha mais grave do sistema), ExpiringProductsModal (desconto em massa sem desfazer), cancelamento em SalesPage (PIN sem contexto, estorno cego), e o Tour com as 13 telas.

**Rodada 5** — As perguntas que você fez: (1) teclado no PDV (60%, com prova do que falta), (2) IA não força consulta nova (3 camadas verificadas), (3) IA só informa (system prompt bloqueia), (4) mapa de fricção quantificado (~13 min/dia).

**Rodada 6** — Você me forçou a admitir o que eu não tinha feito: nunca perguntei "para que esta tela existe", "em que ordem o usuário aprende", "o que acontece quando dá errado", "o que o concorrente faz", e "por que ele pagaria R$ 99,90".

**Rodada 7** — A Parte 0/13: custo em R$ por falha, o que cai na sua mesa (horas de WhatsApp/piloto/semana), seu acerto vs. concorrente, TTFV, o paradoxo guardião×TTFV, o ERP abrindo no lugar errado, o happy path testado contra a tarde de sábado, e a tela "O que sumiu" que não existe.

**Rodada 8** — O relatório SM→PM com backlog em story points e a decisão única na mesa.

---

# PARTE C — OS ACHADOS CONSOLIDADOS (sem repetição, com prova e custo)

Falhas críticas (perdem dinheiro, dado ou confiança). Cada uma: o que, onde no código, o custo real, e a correção.

| # | Falha | Prova | Custo | Correção |
|---|---|---|---|---|
| **F1** | Peso do granel cancelado some sem avisar — a venda não entra | `PesoInputModal.tsx:36-44` + `PDVPage.tsx:472-477` | ~R$ 180-450/mês (30-80 pesagens/dia × taxa de esquecimento) | Toast alto "NÃO adicionado" ou item pendente piscando no carrinho |
| **F2** | Desconto em massa de vencidos sem seleção, sem desfazer, preço vira permanente | `ExpiringProductsModal.tsx:117-160` | Um clique destrói a margem do catálogo; o lote novo entra a preço de queima | Checkbox por item + expiração do preço promocional + confirmação listando o N afetado |
| **F3** | PIX/cartão confirmam por fé (QR vazio, sem comprovante, sem conferência) | `MultiPaymentManager.tsx:98-146` (`qr_code: ''`) | 1-3 estornos de R$ 40-120 descobertos 15 dias depois | Comprovante opcional + aba "A conferir" no fechamento + pendência visual persistente |
| **F4** | Abertura de caixa pede o troco de ontem DE MEMÓRIA (o sistema gravou e não oferece) | `CaixaManager.tsx:242-276` | 1 erro por dia × 30 dias — o dono conclui "o sistema não presta" | Sugerir o fechamento de ontem, pré-preenchido |
| **F5** | Caixa esquecido aberto >14h vira um texto amber de 12px; o dia seguinte mistura turnos | `CaixaHeader.tsx:64,142-147` | 1×/mês = noite recontando gaveta com desconfiança | Modal bloqueante no primeiro toque do PDV + alerta ao dono |
| **F6** | Estorno devolve TUDO ao estoque — o leite aberto volta a ser vendável | `SalesPage.tsx:636` | Estoque fantasma; o inventário não bate | Por item: "volta ao estoque / vai para perda" |
| **F7** | PIN de cancelamento sem contexto (onde configura? quem tem?) | `SalesPage.tsx:652-654` | Caixa travada com cliente na fila + WhatsApp seu às 21h | Link "Não sei meu PIN" + mover a config para onde é usada |
| **F8** | O desconto do caixa ignora o limite configurado do funcionário | `usePDV.ts:455-462` declarado, nunca chamado por `aplicarDescontoItem` | Invisível até o DRE; confiança no "limite" some | Chamar a validação + PIN de gerente se exceder |
| **F9** | O PDV deixa montar a venda toda sem caixa aberto e só avisa no final | `PDVPage.tsx:217,343,576` | Venda travada com cliente esperando | Não deixar escolher produto antes do caixa estar aberto |
| **F10** | Turno compartilhado no MESMO tablet: o próximo operador vende "como" o anterior | `sessionStorage` do navegador, não do operador | O "quem vendeu" sai errado — RH e confiança | Trocar operador rápido por PIN; carrinho amarrado ao operador, limpa na troca |
| **F11** | O PDV não entende etiqueta de balança (EAN 2+PLU+peso) | `pdv.py:576` compara o código literal | Frios/padaria (maior margem) não vendem bipados | Parser da etiqueta GS1 na cadeia do EAN |
| **F12** | Impressora do fechamento falha em silêncio; o dono sai sem o relatório | `printHtml` sem confirmação | Ele descobre à noite; confiança no fechamento cai | Falhar ruidosamente se a impressão não sair |
| **F13** | Auditoria com falha silenciosa e `usuario_id` anulável por formato do JWT | `models.py:2470` `except: pass`; `clientes.py:1013` | A trilha que serviria de prova não prova | Gravar sempre; falha vira log visível; usuario_id obrigatório |

Arquitetura de informação:
| # | Achado | Correção |
|---|---|---|
| **A1** | Menu mostra SFA/Delivery/RH completo para loja de dono+1 caixa (filtro é por cargo; o dono nível 1 vê tudo) | Menu por persona: Operação/Gestão/Config; resto em "Mais" |
| **A2** | Tour de 13 passos com pitch ("Visão de Águia", "Intelligence Hub") — e quem pede ajuda para abrir caixa recebe SFA no passo 3 | 4 ações executáveis na 1ª semana (abrir/cadastrar/vender/fechar) |
| **A3** | Salvar-único atômico para 11 abas de 3 entidades (`Promise.all` de config+estabelecimento+ponto) | Salvar por aba com badge "modificado" |
| **A4** | PIN enterrado em "Sistema & Segurança" | Todo uso aponta a config; mover para onde é usado |
| **A5** | "Cx. 1 / Cx. 2" — feature certa com jargão de supermercado | "Venda 1", "+" = "Deixar essa esperando" |

Visual/semântica:
| # | Achado | Correção |
|---|---|---|
| **V1** | `bg-red-600` no "Concluir Venda"/"Pagar"/total — e no "Cancelar" logo abaixo | Emerald no concluir; vermelho só em cancelar/perigo real |
| **V2** | 10px uppercase com tracking pela tela inteira (627 font-black, 726 uppercase) para persona 50+ sob sol | ≥12px, sem uppercase em rótulo de dado |
| **V3** | `cor_principal` salva e aplicada, zero componentes a usam | Wire nos pontos-chave OU remover o seletor |
| **V4** | `bg-white` sem variante dark: (texto branco em fundo branco) | Checklist de PR; o fix global em index.css já existe |

Técnicas:
| # | Achado | Correção |
|---|---|---|
| **T1** | 3 parsers de `data_validade`; 2 quebram com ISO `'T'` e deixam o vencido entrar | `utils/validade.ts` único, 3 formatos, com teste |
| **T2** | 30 dias hardcoded no badge do carrinho, configurável no resto | Badge lê a mesma config do toast |
| **T3** | Sangria hardcoded R$ 500 (alarm fatigue num mercadinho de R$ 800/dia) | Configurável por segmento na aba Vendas |

Configurações cenário (salvam, não movem nada): `alertas_email`, `alertas_whatsapp`, `arredondamento_valores`, `exibir_preco_tela`, `cor_principal` — verificadas contra zero leitores reais no backend. Regra: vivo ou fora do modelo.

Acessibilidade do operador real: PDV com **0** atributos `aria-*` em 1153 linhas; ProdutoSearch sem `role="combobox"`/setas/Enter (`BuscaGlobal.tsx:123-128` já tem o padrão); toasts sem `aria-live`; 0 modais principais do PDV fecháveis por Esc; 51 botões sem `type="button"`; 10 imagens sem `alt`; o "X" de fechar sessão é um `<div onClick>` de 16px.

O que é de excelente nível e deve ser protegido:
1. PDV offline-first com idempotência UUID e catálogo cacheado
2. Scanner USB wedge com detecção por velocidade (zero config)
3. Sessão do PDV persistida em sessionStorage
4. Stepper de quantidade que não zera ao apagar (`CarrinhoItem.tsx:234-251`)
5. Parse brasileiro de valor no pagamento (`MultiPaymentManager.tsx:7-12`)
6. Bloqueio de vencido com toast imperativo ("Retire da gôndola")
7. CaixaManager: fechamento cego, relatório escapado, preview de sobra/falta antes de confirmar
8. ProductFormModal: lookup BDC + sugestão fiscal + guardião de estoque-zero + deep-links
9. BuscaGlobal: Ctrl+K com setas já funcionais (o padrão a copiar)
10. Consultor M-IA: cache TTL 300s + quota 20 insights/dia com fallback + 40 chat/dia + regras anti-injeção
11. Lock pessimista de estoque entre 2 caixas (`pdv.py:1080 with_for_update`)
12. Internet caindo no meio do clique: enfileira com o mesmo uuid (`usePDV.ts:532-533`)

---

# PARTE D — A IA (resposta honesta às 3 perguntas)

**"Força toda atualização em uma nova consulta?"** Não. `contextos/__init__.py:13-50` cacheia o contexto SQL por 300s; `quota.py:9` limita a 20 refreshes/dia e devolve a última análise sem chamar o LLM; `InsightCard.tsx:77-80` busca 1× por montagem, não por polling. O ponto cego real: o refresh manual consome quota mesmo com o contexto idêntico — comparar hash antes decidiria.

**"Trabalha para o usuário ou só informa?"** Só informa — e o system prompt **bloqueia** ("Não execute ações", `rag.py:15`); zero function-calling. O caminho para ela agir já existe: os deep-links do Hub (`ProductsPage.tsx:288-319` aceitam `openAdjustFor/openDiscardFor/openEditFor`), o wa.me pronto (`CustomersPage.tsx:173-180`). Falta o backend devolver `[{tipo, texto, acao: {tipo, payload}}]` e o front renderizar o [Repor agora] no próprio bullet.

---

# PARTE E — O JULGAMENTO DE PRODUTO (PO)

**E.1 A promessa e a tela que faltam.** Você vende "em 2 meses você sabe exatamente o que está sumindo". O sistema mostra o que foi **vendido**, nunca o que **sumiu**. A tela "O que sumiu" não existe. A única forma de descobrir hoje é o inventário total de 3h que o piloto não faz — e sem ela a promessa do trial não se cumpre e não converte.

**E.2 O dia começa errado.** O lojista começa abrindo o caixa às 6h; o sistema loga no dashboard. Pior: o PDV deixa montar a venda inteira sem caixa aberto e só avisa no F9. Um ERP confiável **não deixa tocar no produto** antes do caixa estar aberto.

**E.3 A tarde de sábado.** O que segura: lock de estoque entre caixas e offline no clique exato. O que não segura: caixa de 29h, turno compartilhado, impressora quieta no fechamento e etiqueta de balança. O piloto vive nas quatro.

**E.4 Benchmark honesto.** Você ganha nas 5 coisas difíceis (offline, lookup, fechamento cego, guardião, IA) e perde nas 4 que a caixa usa toda hora (teclado completo, fiado proativo, não misturar turno, granel que não some). PDV não se julga pela arquitetura; julga-se pelo "fecha o dia certo sem eu pensar".

**E.5 O paradoxo que dita a arquitetura.** Guardião × TTFV: o formulário hoje protege o dado travando o fluxo. Saída: entrada rápida + revisão — o dado entra com o mínimo e o guardião marca "para revisar" em lote no fim de semana. Guardião no dado, não no fluxo.

**E.6 O que o piloto não perdoa.** Não é pixel nem cor — é o sistema saber a resposta e escolher não mostrar/bloquear/executar. Cada silêncio é um WhatsApp seu às 21h de sábado.

---

# PARTE F — PLANO DE SPRINTS (SM → PM)

**Sprint 1 — "Não se machuque" (9 pts):** PDV bloqueado sem caixa; modal de caixa >14h; abertura com âncora de ontem; trocar operador por PIN; peso cancelado avisa; parser único de validade; desconto com validação+PIN; estorno por item.
Saída: o sistema não se machuca sozinho; o primeiro fechamento com funcionário não explode.

**Sprint 2 — "Aprenda sem mim" (8 pts):** Modo Pallet; menu por persona; onboarding executável de 4 ações; dashboard "Hoje" com ação; auditoria sempre com usuario_id.
Saída: TTFV < 20 min sem você. Vende o próximo cliente por boca-a-boca.

**Sprint 3 — "A promessa" (5 pts):** tela "O que sumiu" (contagem cíclica); Insight da IA com botão de ação.
Saída: o dono lê "esta semana sumiram 4 iogurtes e 1 azeite" — nesse dia o produto se paga na cabeça dele.

**Total: 22 dias-dev ≈ 5-6 semanas.**

Riscos registrados: entrar antes do Sprint 3 e perder o contrato no trial; entrar antes do Sprint 1 e o fechamento com funcionário explodir; Modo Pallet pressionar o guardião (mitigar com revisão em lote); visual consumir sprint de operação; escopo escapar para fiscal/delivery.

**Recomendação:** não entrar no piloto amanhã. Entrar com Sprints 1+2 prontos e a tela do Sprint 3 prometida e datada — o critério de sucesso do trial amarrado a uma feature com data, não a uma esperança.

---

# PARTE G — O QUE EU ERREI NESTA SESSÃO (registrado para não se repetir)

1. Afirmei que o fiado vendia "sem mostrar a dívida" — errado. O badge existe (`ClienteSelect.tsx:81-85`); o problema real é ser passivo, não ausente.
2. Afirmei que o tour "sequestrava o primeiro login" — errado. É on-demand (`TourExecutivo.tsx:119-126`). O problema real: 13 passos de pitch quando pedem ajuda para o PDV.
3. Afirmei que a balança "não existia" — errado. O modelo tem (PLU + prefixo 20 GS1). O que falta é o parser da etiqueta no PDV.
4. Afirmei que a auditoria "não tinha identificador" — errado na forma, certo no fundo. A coluna existe; uma rota a anula por formato de JWT e a falha ao gravar é engolida.
5. Tratei "plano de UX" como lista de bugs de tela por 4 rodadas antes de perguntar para que a tela existe.

Cada erro acima está corrigido no corpo deste documento com a prova em arquivo:linha — sem reescrever a história.

---

# ANEXO — ONDE CADA PROVA VIVE

- Documento técnico completo (Partes 0–XIII, 38k chars): `docs/ANALISE_UX_UI_PILOTO_2026-10-31.md`
- Relatório SM→PM com backlog datado: `docs/RELATORIO_SM_PM_UX_PILOTO_2026-10-31.md`
- Este consolidado: `docs/CONTEXTO_SESSAO_UX_PILOTO_2026-10-31.md`

*Nenhum arquivo de código foi modificado nesta sessão.*
