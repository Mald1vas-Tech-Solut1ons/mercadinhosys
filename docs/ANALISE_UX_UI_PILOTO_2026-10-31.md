# Análise Profunda de UX/UI — MercadinhoSys
## Perante a Regra de Negócio do Piloto

**Data:** 2026-10-31 (edição aprofundada)
**Escopo inspecionado (código lido na íntegra):**
PDVPage.tsx (1153), usePDV.ts (614), ProdutoSearch.tsx, CarrinhoItem.tsx, MultiPaymentManager.tsx, ClienteSelect.tsx, PesoInputModal.tsx, CaixaManager.tsx (636), CaixaHeader.tsx, ProductFormModal.tsx (1337), ProductsPage.tsx (1113), ProductHubPage.tsx (764), LotesDisponiveisModal.tsx, ExpiringProductsModal.tsx (365), SalesPage.tsx (674), SettingsPage.tsx (1410), DashboardPage.tsx, Sidebar.tsx, BottomNavigation.tsx, MainLayout.tsx, TourExecutivo.tsx, BuscaGlobal.tsx, LoginPage.tsx, PurchasesPage.tsx, permissions.ts, ConfigContext.tsx, index.css, GlobalShortcuts.tsx, registry.ts.

**Backend auditado onde a tela depende:** consultor.py, quota.py, rag.py, contextos/__init__.py, query_helpers.py, auth_multi_tenant.py, pdv.py, vendas.py, models.py.

---

# PARTE 0 — AS PERGUNTAS QUE VOCÊ NÃO FEZ (e que mudam a decisão)

As análises anteriores respondem "onde a tela erra". As quatro perguntas abaixo respondem o que isso faz com o seu dinheiro, seu tempo e o seu piloto.

## 0.1 — Quanto custa, em reais e churn, cada falha?

Não é "UX é importante". É:

| Falha | Custo direto por mês por piloto | Como escala |
|---|---|---|
| **Granel que some (F1)** | ~R$ 180–450 em venda perdida não registrada (30 pesagens/dia × 22 dias × taxa de esquecimento realista 2–5%) | cresce com o mix de peso da loja |
| **PIX confiado sem conferência (F3)** | 1–3 ocorrências de R$ 40–120 estornadas descobertas 15+ dias depois | cresce com a fila |
| **Caixa misturando 2 turnos (F5)** | 1× por mês = o dono gasta uma noite recontando e passa a desconfiar do sistema | **churn direto no piloto** |
| **Abertura por memória (F4)** | quebra acumulada pequena todo dia — e o dono conclui "o sistema não presta" | **churn indireto** |
| **5h de cadastro no 1º dia (J6)** | se falhar no primeiro dia, ele não volta — é o único dia que ele está disposto a aprender | **churn maior e mais cedo** |
| **PIN travando cancelamento (F7)** | 1 ligação sua às 21h | no seu tempo |
| **Desconto sem freio (F8)** | invisível até o DRE do mês | silencioso |

Total estimado por piloto no primeiro mês: **R$ 400–800 em dinheiro perdido + 1 a 3 noites de desconfiança**. É o suficiente para o seu cliente-piloto de R$ 99,90/mês decidir que "sistema é complicado" e que o caderninho era mais confiável — e você nunca saberá o porquê, porque ele não liga para reclamar do peso do granel que sumiu.

## 0.2 — O que cai na SUA mesa?

Você é o suporte. Cada ponto de fricção ou de silêncio vira uma interrupção sua:

| Origem | Mensagem que você recebe | Frequência estimada no piloto |
|---|---|---|
| Caixa esquecido (F5) | "o caixa tá dobrado, o sistema bugou" | 1×/mês |
| Granel sumido (F1) | "o estoque não bate" | 2×/mês (com 1 mês de atraso — só no inventário) |
| PIN (F7/A4) | "que PIN é esse?" | no primeiro cancelamento |
| Menu com SFA/Delivery (A1) | "o que é Força de Vendas?" | primeira semana |
| Save único de config (A3) | "salvei e mudou tudo errado" | na primeira configuração séria |
| Vencido entrando (T1) | "vendi um produto vencido, o sistema deixou" | quando o fornecedor trocar o formato da data |
| Dashboard sem "hoje" | "não mostra o que vendi hoje" | primeira semana, toda vez que ele abre |

7 fontes de chamado, todas silenciosas hoje. Se cada uma é 20 minutos seus, são **2h20 da sua semana** respondendo o que a tela deveria ter resolvido sozinha — por UM cliente. Com 10 pilotos, sua vida vira suporte e o produto não sai do lugar.

A métrica correta de UX para você agora não é NPS nem taxa de conversão: é **horas suas de WhatsApp por piloto por semana**. Cada achado deste documento é medido contra ela.

## 0.3 — Seus acertos vs. o que o concorrente entrega pelos mesmos R$ 99

| Sua excelência hoje | TOTVS/Linx no mesmo preço? | Quem ganha |
|---|---|---|
| Offline-first com idempotência e cupom local | Não — TOTVS cai sem internet | **Você** |
| Lookup BigDataCorp com foto/NCM no bip | Não — cadastro manual ou base cara | **Você** |
| Fechamento cego com preview de sobra | Parcial — módulo separado caro | **Empate/você** |
| Guardião de cadastro (não deixa lixo) | Não | **Você** |
| RAG + Consultor com cache e quota | Não no nicho | **Você** |
| PDV rápido com teclado completo | **Sim — é o requisito mínimo do nicho** | **Concorrente** |
| Vender fiado com limite proativo na hora | Sim — o caderninho digitalizado faz isso | **Concorrente** |
| Não misturar turnos de caixa | Sim — qualquer PDV bloqueia | **Concorrente** |
| Granel que não se perde | Sim | **Concorrente** |

O quadro honesto: você já tem um produto **melhor que o concorrente nas 5 coisas difíceis** (offline, lookup, fechamento cego, guardião, IA) e **pior nas 4 coisas que a dona do mercado usa a cada hora** (teclado completo, fiado proativo, não misturar caixa, granel que não some).

Ela não compara por dificuldade técnica. Compara por "vendeu direito hoje?".

## 0.4 — A pergunta que ninguém fez e que decide tudo: **em quanto tempo o primeiro cliente faz a primeira venda sem ajuda sua?**

Todo o road map do piloto deveria ser medido contra UMA métrica de onboarding:

> **TTFV — Time To First Venda: do primeiro login à primeira venda concluída, sem você ao lado.**

Hoje, o caminho é: provisionar tenant → você cria o usuário → dono loga → vê menu com 23 itens → clica em Tour → vê 13 telas → volta ao menu → acha o PDV → descobre que precisa "abrir caixa" (sem saber que existe) → erra o saldo inicial de memória (F4) → começa a cadastrar produtos → desiste no 5º (J6) → WhatsApp.

**TTFV hoje: dias, com ajuda sua.**

O TTFV que o seu princípio de produto ("o sistema trabalha para o usuário") exige: **login → tela com UM card "Abrir meu caixa" com saldo sugerido de ontem → card "Cadastrar meu primeiro produto" que abre o scanner no bip → primeiro bip → F4 → dinheiro → Enter → cupom → "Você vendeu!"**.

Nenhuma outra tela visível até acontecer. Depois disso ele aprende o resto por necessidade — a melhor ordem de aprendizado.

O **Modo P pallet (J6)** + **abertura-âncora (F4)** + **menu reduzido (A1)** são juntos o TTFV < 20 minutos. São 3 das 25 ações do plano. É o único investimento que reduz churn, reduz seu suporte e vende o cliente seguinte (boca a boca do bairro) ao mesmo tempo.

## 0.5 — O paradoxo a resolver, explícito (porque ele dita a arquitetura)

Você tem DUAS restrições em conflito e o código atual escolheu errado em ambas:

| Restrição | O que pede | O que o código faz |
|---|---|---|
| **Não deixar o leigo errar** (guardião) | obrigar subcategoria, validade, NCM, PIN | 5 campos obrigatórios no cadastro; PIN sem contexto |
| **Não travar o leigo** (TTFV) | cadastrar 200 itens bipando, vender sem pensar | 90s por item; setas do teclado não selecionam |

A saída não é tirar o guardião — é **separar o fluxo em "entrada rápida + revisão"**: o dado entra com o mínimo (bipa, preço, quantidade), o guardião marca como "para revisar", e a classificação fiscal vira uma tarefa em lote do fim de semana, não uma obrigação do meio da entrega. **Guardião no dado, não no fluxo.** O desenho aprovado (cadastro-guardiao-design.md) já sabe disso — o formulário ainda não implementa.

---

# SUMÁRIO EXECUTIVO

O MercadinhoSys tem a **espinha dorsal técnica correta** para o piloto: PDV offline-first com idempotência, cadastro com guardião contra lixo, fechamento cego, bloqueio de vencido, lookup de produto por EAN, deep-links entre módulos, Consultor M-IA com cache e quota. Isso é acima da média do nicho.

O que falha não é a arquitetura — é o **comportamento no momento exato da decisão do usuário leigo**. O padrão que se repete em todos os achados:

> **O sistema sabe a resposta e escolhe não mostrá-la, não bloqueá-la, não executá-la — ou mostra tarde demais.**

O caixa esquecido aberto 29 horas é detectado e renderiza um texto amber de 12px. A venda de fiado do maior devedor da loja é calculada no backend e aparece só se o operador procurar o cliente. O fechamento de ontem é gravado e não é oferecido na abertura de hoje. O desconto-máximo do funcionário é configurado e nunca aplicado. O produto vencido pode entrar no carrinho se a data vier em formato ISO.

Nenhum é pixel. Todos são decisões de UX que **tratam o operador como diligente** — e o piloto não é diligente, é humano com fila no balcão.

---

# PARTE I — PERSONAS E CONTEXTO DE USO

Sem persona, análise de UX é gosto pessoal. Três governam todos os veredictos:

| Persona | Quem é | O que faz | Quando | O que não tolera |
|---|---|---|---|---|
| **DONO** | 50+, primeiro sistema da vida, Android intermediário + notebook 1366×768 | Cadastra pallet 5h, olha painel 7h, cobra fiado 17h, fecha caixa 20h | Madrugada/manhã/noite | Silêncio do sistema quando algo deu errado |
| **CAIXA** | Contratada, leiga, 18 ou 58 anos, aprende vendo o dono 2× | Bipa, pesa granel, recebe pagamento, cancela venda errada | O dia inteiro sob fila | Ter que lembrar algo que o sistema sabe |
| **SUPER ADMIN (você)** | Suporte/dev/vendedor, atende WhatsApp 21h de sábado | Espelha loja, provisiona, responde "está dando erro" | Quando quebra | Fricção do piloto que vira ligação sua |

**Jornadas testadas contra o código:**
J1 Abrir caixa 6h · J2 Vender bipando · J3 Vender granel · J4 Receber PIX/cartão · J5 Vender fiado · J6 Cadastrar pallet 5h · J7 Fechar caixa 20h · J8 Cancelar venda errada · J9 Vencimentos · J10 Primeiro dia do piloto · J11 "Quanto tá dando?" · J12 Buscar qualquer coisa de qualquer lugar.

---

# PARTE II — JORNADA CRONOLÓGICA DO PILOTO (onde quebra, quanto custa)

## 05:00 — O pallet chega (J6)

### O que o dono faz
200 itens soltos e com código, porta aberta. Precisa bipar e sair. Cada produto é: bipa → sistema preenche → preço + quantidade → etiqueta → próximo.

### O que o código entrega
`ProductFormModal.tsx` é a **melhor peça de UX do sistema**:
- EAN foca sozinho ao abrir (`:473`)
- Lookup dispara sozinho com 8+ dígitos válidos (`:393-404`)
- Preenche nome/marca/NCM/foto/família (`:290-351`) e diz o que preencheu ("Preenchido (catálogo): nome, marca, NCM, família...")
- Guardião de estoque-zero consciente com `confirmar()` (`:572-581`)
- Sugestão fiscal por família com "revise com seu contador" (`:960-969`)
- Deep-link do Ctrl+K abre o edit direto (`ProductsPage.tsx:294-298`)

### Onde quebra
**5 campos obrigatórios mesmo com o lookup perfeito.** Depois do autofill, o dono ainda escolhe subcategoria no CategoriaPicker, digita custo, decide margem, digita estoque, e (se família com validade) data+lote. **200 produtos × 90s = 5 horas em pé.** Na vida real: cadastra 12, desiste, e o resto entra como "MISC" ou não entra — o guardião segura o lixo E segura o cadastro.

**Correção — "Modo Pallet":** bipa → dois campos (preço, quantidade) → Enter → próximo. Subcategoria inferida pelo NCM + "revisar depois" na Lista de Revisão. O guardião protege; o dado entra; a classificação fiscal fica para o fim de semana, não para o meio da entrega.
**Impacto:** 5h → 1h7m no primeiro dia.

---

## 06:00 — Abrir o caixa (J1)

### Onde quebra
`CaixaManager.tsx:242-276` — modal bonito com 1 campo "Saldo Inicial (R$)". O troco final de ontem (R$ 347,50) está gravado no fechamento anterior e **não é oferecido**. O dono digita de memória R$ 150. Erro de R$ 2,50. O dia inteiro vende com saldo quebrado.

**Correção:** "Fechamento de ontem: R$ 347,50 — usar este valor ou digitar outro" + pré-preenchido. Zero mudança de backend.
**Impacto:** elimina a causa #1 de quebra de caixa do piloto (erro de memória na abertura).

---

## 07:00 — O dono olha o painel (J10 parcial)

### Onde quebra
`DashboardPage.tsx:23` `daysFilter = 30` — o default **esconde o hoje e o ontem**. As 3 perguntas que ele faz:
1. Fechei bem ontem?
2. Alguém me deve vencendo hoje?
3. Falta o quê na gôndola?

O que ele vê: jargão ("Visão Executiva", "Estoque Inteligente"), período de 30 dias, e alertas sem ação embutida.

**Correção:** Default "Hoje" + cards com ação ("Repor agora", "Cobrar no WhatsApp") + abas em linguagem de loja.

---

## 08:00 → 20:00 — Vender o dia inteiro (J2, J3, J4, J5, J8, J11)

### J2 — Vender bipando

**Excelências (proteger):**
- Scanner wedge com detecção por velocidade, zero config (`PDVPage.tsx:179-212`)
- Sessão persistida em sessionStorage (`usePDV.ts:75-90`)
- Anti-double-submit + idempotência UUID (`PDVPage.tsx:150-157`)
- Toast imperativo de vencido ("Retire da gôndola")

**Onde quebra — produto SEM código de barras:**
`ProdutoSearch.tsx:228-329` — a lista de resultados é uma `<div onClick>`, **zero handler de teclado**. Setas não navegam, Enter não seleciona. Todo produto solto — a **maioria do pallet do piloto** — exige tirar a mão do teclado.
**Fricção:** 60/dia × 3s = **3 min/dia**. Correção: copiar o padrão já implementado em `BuscaGlobal.tsx:123-128` (ArrowUp/Down/Enter/Escape) — a própria codebase já tem o modelo.

**E o guard do scanner-wedge está ausente:** `PDVPage.tsx:194` aceita bip **com o drawer de pagamento aberto**. O operador bipa o produto do próximo cliente no meio do pagamento atual → entra no carrinho que fecha em F9.

---

### J3 — Granel (padaria/hortifrúti/açougue)

**A falha mais grave do sistema:**
`PesoInputModal.tsx:36-44` + `PDVPage.tsx:472-477`. Bipa → modal abre → operador clica fora ou Esc → `setProdutoPendentePeso(null)` → **o produto some sem aviso, não entra no carrinho**. O cliente sai sem pagar. O estoque erra à noite — e a divergência é invisível porque nunca entrou.

30-80 pesagens/dia: estatisticamente certo de acontecer toda semana.

**Correção:** toast alto "Café NÃO adicionado — bipe novamente" OU o item entra pendente piscando no carrinho.

---

### J4 — PIX e Cartão

Confirmam por fé (`MultiPaymentManager.tsx:98-146` — `qr_code: ''`, `txid: ''`: strings-decoração). O dono descobre o estorno 15 dias depois no extrato.

**Correção mínima:** comprovante opcional + flag "Exigir conferência no fechamento" → aba "A conferir: 4 PIX, R$ 287" no Gerenciar Caixa, que o dono marca um a um contra o extrato à noite.

---

### J5 — Fiado

**Corrigindo meu erro anterior:** a dívida **aparece** (`ClienteSelect.tsx:81-85, 155-157`) — badge "FIADO: R$ 890" na lista e no cliente selecionado. Mas é passiva: não impede, não alerta por threshold, não usa o `sugestao_limite` que o backend calcula.

**Correção:** selecionar cliente com `saldo_devedor > 0` → banner no drawer "João já deve R$ 890 (último pag: 12/out). Limite sugerido: R$ 500." + opcional bloqueio por PIN.

---

### J8 — Cancelar a venda errada

Duas falhas:
1. **PIN sem contexto** (`SalesPage.tsx:652-654`) — não diz onde configura, quem tem, nem link. Caixa trava, cliente espera no balcão, WhatsApp seu às 21h.
2. **Estorno cego** (`SalesPage.tsx:636`) — "estornados ao estoque automaticamente": o leite aberto volta a ser vendável. Correto: por item, "Volta ao estoque / Vai para perda", registrando a perda no DRE.

---

### J11 — "Quanto tá dando?"

O balcão usa 40×/dia e o PDV não tem **modo consulta**: bipa para responder o preço e o item entra no carrinho da venda que não existe. Correção: Shift+bip ou botão "?" no resultado — card grande com preço que some em 5s.

---

### O acerto certo com o nome errado
Multi-sessão ("Cx. 1 / Cx. 2" + "+") atende o caso real do mercadinho (dona Maria foi buscar a carteira). **Feature certa; rótulo errado para a persona.** Renomear: "Venda 1 / Venda 2", "+" para "Deixar essa esperando".

---

## 20:00 — Fechar o caixa (J7)

### Excelências (proteger)
- Fechamento cego implementado (`CaixaManager.tsx:430-435`) — conta a gaveta sem ver o esperado
- Preview de sobra/falta **antes** de confirmar (`:533-562`)
- Relatório impresso com escape em TODO valor do banco (`:103-161`)
- Sangria/Suprimento com descrição obrigatória

### A falha que estraga o dia seguinte
**Caixa esquecido aberto.** `CaixaHeader.tsx:64` detecta (>14h); `:142-147` renderiza um parágrafo amber de 12px. A funcionária do sábado não lê. Sábado inteiro entra no caixa de sexta.

**Correção:** primeiro toque no PDV com caixa >14h = **modal bloqueante**: "Caixa de SEXTA aberto há 29h. [Fechar turno anterior (valor contado)] / [Continuar neste turno]" + alerta ao dono.

---

## O primeiro dia (J10)

`TourExecutivo.tsx`: 13 passos de pitch. **Correção do meu erro anterior: não dispara sozinho** — só abre pelo botão "Tour & Ajuda" (`:119-126`). Mas quem aperta querendo saber "como abrir o caixa" recebe 13 telas navegando por SFA/Delivery/Compras antes do PDV (passo 5) e sai sem saber abrir o caixa.

**Correção:** 4 ações executáveis na primeira semana (Abrir caixa → Bipar → Receber → Fechar), cada uma com botão que faz, não explica.

---

# PARTE III — FALHAS CRÍTICAS CONSOLIDADAS (F1-F8)

As 8 falhas que perdem dinheiro, dado ou confiança — com arquivo:linha e a jornada quebrada:

| # | Falha | Evidência | Jornada |
|---|---|---|---|
| **F1** | Peso cancelado perde venda em silêncio | `PesoInputModal.tsx:36`, `PDVPage.tsx:472` | J3 |
| **F2** | Desconto em massa sem seleção/desfazer, preço vira permanente | `ExpiringProductsModal.tsx:117-160` | J9 |
| **F3** | PIX/cartão confirmam por fé | `MultiPaymentManager.tsx:98-146` | J4 |
| **F4** | Abertura sem âncora de ontem | `CaixaManager.tsx:242-276` | J1 |
| **F5** | Caixa >14h renderiza só texto amber | `CaixaHeader.tsx:64,142` | J7 |
| **F6** | Estorno devolve tudo ao estoque | `SalesPage.tsx:636` | J8 |
| **F7** | PIN sem contexto no cancelamento | `SalesPage.tsx:653` | J8 |
| **F8** | Desconto do caixa ignora limite do funcionário (`validarDescontoPermitido` declarado, nunca chamado) | `usePDV.ts:455-462` | J2 |

---

# PARTE IV — ARQUITETURA DE INFORMAÇÃO (A1-A5)

## A1. Menu exibe módulos que o piloto não tem
`Sidebar.tsx:44-58` — SFA, Gestão SFA, Logística completa, RH & Ponto com Holerite/Rescisão. O filtro é por **cargo**; o dono é nível 1, vê tudo. Não há filtro por **perfil de loja**. Gera WhatsApp de suporte.
**Correção:** Operação Diária / Gestão / Configuração. Resto atrás de "Mais módulos".

## A2. Tour de 13 passos de pitch
O dono pede ajuda para abrir caixa, recebe SFA e Delivery. **Correção:** 4 ações executáveis, J10.

## A3. Salvar-único atômico para 11 abas de 3 entidades
`SettingsPage.tsx:470-507` — `Promise.all` de config + estabelecimento + ponto. Erro não diz o que salvou. **Correção:** salvar por aba, badge "modificado".

## A4. PIN enterrado em "Sistema & Segurança"
O ponto de uso (cancelamento em Vendas, descarte em Produtos) não aponta o ponto de config. **Correção:** todo uso com link "Configurar PIN"; mover para onde é usado.

## A5. "Cx. 1" — jargão de supermercado
Feature certa, palavra errada. **Correção:** "Venda 1", "+" vira "Deixar essa esperando".

---

# PARTE V — VISUAL/SEMÂNTICA (V1-V4)

## V1. Vermelho como cor da ação-felicidade
`bg-red-600` em "Pagar", "Concluir Venda", total a pagar (`PDVPage.tsx:577,604,1035`) — e no "Cancelar Venda" logo abaixo. Três significados de perigo/débito na mesma tela (vermelho = cancelar, = sem estoque, = vencido). Na literacia do brasileiro, vermelho = estorno.
**Correção:** "Concluir Venda" emerald-600; vermelho só para cancelar/estorno/risco real; total neutro.

## V2. 10px uppercase com tracking para persona 50+ sob sol
627 × `font-black`, 726 × `uppercase`. Badges do PDV em `text-[10px] font-black uppercase tracking-widest`. WCAG exige 12px mínimo para dado operacional. Uppercase destrói acentuação em pt-BR a 10px.
**Correção:** Badges ≥ 12px, sem uppercase em rótulo de dado.

## V3. `cor_principal`: cenário ativo
Salva e aplica como CSS var (`ConfigContext.tsx:130`) — **zero consumidores** do `var(--color-primary)` nos componentes. O dono troca, vê "salvo", nada muda. Pior que cenário puro.
**Correção:** wire nos pontos-chave OU remova o seletor.

## V4. `bg-white` órfão de dark:
O fix global existe em `index.css`. Falta checklist de PR: todo `bg-white` novo exige `dark:bg-gray-800` par.

---

# PARTE VI — ACESSIBILIDADE (o caixa que usa teclado)

Contagem no código-fonte:

| Verificação | Resultado | Deveria |
|---|---|---|
| `aria-*` no PDVPage (1153 linhas) | **0** | Vários |
| `role="combobox"`/setas/Enter em ProdutoSearch | **0** | A lista inteira |
| `aria-live` nos toasts | **0** | `role="status"` |
| Esc fecha os modais principais do PDV | **0** | Padrão |
| `aria-modal` + foco preso | só `components/ui/Confirmacao.tsx` | Todo modal |
| `<button>` sem `type="button"` nos features/pdv | **51** | Todo fora de submit |
| `<img>` sem `alt` | **10** | Todas |
| X de fechar sessão é `<div onClick>` 16px | `PDVPage.tsx:510` | `<button>` 44px |

Sem setas e sem Esc, o caixa nunca atinge o "bipar sem olhar" que o produto promete.

---

# PARTE VII — INCONSISTÊNCIAS TÉCNICAS (T1-T3)

## T1. 3 parsers de `data_validade` divergentes
`ProdutoSearch.tsx:129` lida com ISO `'T'`; `usePDV.ts:305` e `CarrinhoItem.tsx:184` só aceitam `'-'` ou `'/'`. Se o backend devolver ISO com `'T'`, `usePDV` calcula `new Date(NaN, NaN, NaN)` — `NaN < hoje` é `false` — **o vencido ENTRA no carrinho**. A regra central do guardião ("nunca vender vencido") depende do formato da string.
**Correção:** `utils/validade.ts` único, usado nos 3 pontos, com teste dos 3 formatos.

## T2. 30 dias hardcoded no badge do carrinho
`CarrinhoItem.tsx:191` — `+30` fixo; `usePDV.ts:323` lê a config; Settings configura. Mesmo item, dois avisos.
**Correção:** o badge lê a mesma config do toast.

## T3. Sangria hardcoded R$ 500
`usePDV.ts:541`. Num mercadinho de R$ 800/dia, dispara alarme falso todo dia e ensina o operador a ignorar toast — inclusive o do vencido.
**Correção:** configurável na aba Vendas & PDV.

---

# PARTE VIII — SWITCHES CENÁRIO (salvam, não movem nada)

Auditoria de cada chave contra `backend/app/`:

| Chave | Leitores reais fora GET/seed | Veredicto |
|---|---|---|
| `alertas_email`, `alertas_whatsapp` | só query_helpers (read/write) | **Cenário** |
| `arredondamento_valores` | único uso: literal `0.05` em `vendas.py:1713` sem ler o flag | **Cenário** |
| `exibir_preco_tela` | chega ao front, nenhum componente consome | **Cenário** |
| `cor_principal` | ver V3 — aplicada e ignorada | **Cenário ativo** |
| `tentativas_senha_bloqueio`, `tempo_sessao_minutos`, `controlar_validade`, `permitir_venda_sem_estoque`, `bloquear_venda_vencido`, `impressao_automatica` | lêem de verdade | Vivo |
| `desconto_maximo_funcionario` | back lê; **front ignora** → F8 | Vivo no back, quebrado no front |

**Regra:** switch vivo ou fora do modelo. Os 4 cenários precisam ser removidos ou ganhar efeito — e nenhum está na tela por sorte de layout, não por decisão.

---

# PARTE IX — A IA: O QUE ESTÁ CERTO, O QUE FALTA

## Economia de chamadas — já correta
| Camada | Arquivo | Comportamento |
|---|---|---|
| Cache de contexto SQL | `services/consultor/contextos/__init__.py:13-50` | TTL 300s por (especialista, loja) — recarregar dashboard não refaz query |
| Quota diária de insights | `quota.py:9` + `consultor.py:187-201` | >20/dia devolve última análise cacheada sem chamar LLM |
| Quota de chat | `quota.py:8` | 40/dia; insights não contaminam |

E `InsightCard.tsx:77-80` chama 1× por montagem — não há polling. O front não dispara consulta nova sozinho.

**Otimização possível:** se o hash do contexto cacheado é o mesmo da última resposta, devolvê-la sem cobrar quota nem chamar LLM.

## A IA informa, não trabalha — e o prompt bloqueia explicitamente
`rag.py:15` injetado em TODA mensagem: *"Não execute ações, não faça cobranças..."* + zero function-calling no módulo.

O card diz: "Reponha o Café 3 Corações — estoque zerado há 2 dias." O dono então sai do dashboard, vai a Produtos, procura, abre modal, digita, salva. **Cinco cliques executando o que a IA já diagnosticou.**

A infra para a IA agir já existe: deep-links do Hub (`ProductsPage.tsx:288-319` recebem `openAdjustFor/openDiscardFor/openEditFor`), wa.me pronto (`CustomersPage.tsx:173-180`), ExpiringProductsModal por state.

**O que falta:** backend devolver `[{tipo, texto, acao: {tipo, payload}}]` em vez de 3 strings; e o front renderizar **[Repor agora] [Cobrar no WhatsApp] [Aplicar promoção]** dentro do bullet. A IA abre o formulário preenchido; o humano autoriza. Padrão "IA trabalha, humano decide".

---

# PARTE X — REDUÇÃO DE FRICÇÃO: O MAPA QUANTIFICADO

| Fricção | Arquivo | Vezes/dia × seg extra | Custo |
|---|---|---|---|
| Selecionar produto da busca exige mouse | `ProdutoSearch.tsx:239` | 60 × 3s | 3 min/dia |
| Ajustar quantidade exige clique +/− | `CarrinhoItem.tsx:227` | 40 × 2s | 1,3 min |
| PIX confiado = 2 cliques | `MultiPaymentManager.tsx:98-119` | 20 × 4s | 1,3 min |
| Peso cancelado some → re-bipar | `PesoInputModal.tsx` | até 30 × 8s | 4 min |
| Abrir caixa exige memória | `CaixaManager.tsx:251` | 1 × 30s + quebra o dia | imprevisível |
| Insight sem botão de ação | `InsightCard.tsx` | 5 × 40s | 3,3 min |
| Salvar config = 1 botão p/ 3 entidades | `SettingsPage.tsx:470` | toda configuração | erro oculto |
| PIN sem contexto | `SalesPage.tsx:653` | primeiro uso | 5 min travado |

**Total conservador: ~13 min/dia por operador** — mais o custo não-linear: cada ponto é uma chance de venda esquecida, PIX desconfirmado ou caixa quebrado. Cada um vira WhatsApp seu às 21h.

As cinco primeiras (setas no ProdutoSearch + guard do scanner + toast no peso + âncora de abertura + botão de ação no Insight) são o maior ganho de produtividade por linha de código do projeto neste momento.

---

# PARTE XI — O QUE É DE EXCELENTE NÍVEL (proteger)

1. **PDV offline-first** com idempotência UUID e catálogo cacheado — a promessa mais difícil, entregue
2. **Scanner wedge com detecção por velocidade** — zero configuração
3. **Sessão do PDV persistida** em sessionStorage
4. **Stepper de quantidade** que não zera ao apagar (`CarrinhoItem.tsx:234-251`)
5. **Parse brasileiro de valor** no pagamento
6. **Bloqueio de vencido com toast imperativo** ("Retire da gôndola")
7. **CaixaManager**: fechamento cego, relatório escapado, preview de sobra/falta antes de confirmar — o melhor modal do sistema
8. **ProductFormModal**: lookup BDC + sugestão fiscal + guardião de estoque-zero consciente + deep-link — a referência do que a equipe sabe fazer
9. **BuscaGlobal**: Ctrl+K com setas/Enter já funcionais (`:123-128`) — o padrão a copiar no ProdutoSearch
10. **Consultor M-IA**: cache + quota + RBAC + regras anti-injeção — mais parrudo que muita feature "IA" de produto grande

---

# PARTE XII — PLANO DE EXECUÇÃO (ordem por impacto no piloto)

| # | Ação | Resolve | Por que agora |
|---|---|---|---|
| **P0-1** | `ProdutoSearch`: setas/Enter/Tab/role=listbox (copiar `BuscaGlobal.tsx:123`) | Teclado+Fricção | Interação nº 1 do dia — todo produto sem EAN |
| **P0-2** | Modal de peso cancelado: toast alto ou item pendente piscando | F1 | Perda de venda estatisticamente certa toda semana |
| **P0-3** | Guard do scanner-wedge: aceita bip só com drawer fechado | J2 | Bip do próximo cliente entra na venda que fecha |
| **P0-4** | Abertura de caixa com sugestão do fechamento anterior | F4 | Caixa erra o dia inteiro por memória |
| **P0-5** | Caixa >14h aberto → modal bloqueante no primeiro toque do PDV | F5 | Dois turnos misturados |
| **P0-6** | Parser único `utils/validade.ts` nos 3 pontos | T1 | Vencido pode ENTRAR no carrinho |
| **P0-7** | `aplicarDescontoItem` chama `validarDescontoPermitido` + PIN se exceder | F8 | Limite configurado é decorativo |
| **P0-8** | Desconto em massa de vencidos: checkbox por item + expiração do preço | F2 | Um clique destrói margem sem desfazer |
| **P1-1** | "Concluir Venda" emerald-600; vermelho só para cancelar/estorno | V1 | Erro semântico na ação mais frequente |
| **P1-2** | Toast `aria-live`; Esc nos modais do PDV; X de sessão vira `<button>` 44px | Acessibilidade | O caixa usa teclado e pode não ver toast |
| **P1-3** | Estorno por item: "volta ao estoque / vai para perda" | F6 | Estoque fantasma |
| **P1-4** | PIN: link "Não sei meu PIN" nos pontos de uso + mover seção | F7+A4 | Travamento no sábado à noite |
| **P1-5** | InsightCard: ação com botão (Repor / Cobrar / Promoção) | Parte IX | A IA trabalha, humano autoriza |
| **P1-6** | Dashboard: default "Hoje", cards com ação, abas em linguagem de loja | J7+J10 | Dado sem ação é decoração |
| **P1-7** | Menu do piloto: remover SFA/Delivery/RH completo via flag de plano | A1 | Reduz WhatsApp |
| **P2-1** | PIX/cartão: comprovante + aba "A Conferir" no fechamento | F3 | Fechamento confiável |
| **P2-2** | Sangria configurável; multi-sessão "Venda 1/2"; badge ≥12px sem uppercase | T3+A5+V2 | Alarm fatigue e jargão |
| **P2-3** | Salvar por aba em Configurações | A3 | Promise.all de 3 entidades |
| **P2-4** | Tour de 4 ações executáveis na 1ª semana | J10 | Onboarding = primeira venda |
| **P2-5** | Remover as 4 chaves cenário OU implementar efeito | Config | Nunca o falso no modelo |
| **P2-6** | Wire `cor_principal` → bg-primary OU remover seletor | V3 | Cenário ativo frustra mais |
| **P2-7** | Modo Pallet: bipa→preço+estoque→Enter, 20s/item | J6 | 5h → 1h no primeiro dia |
| **P2-8** | Modo consulta de preço no PDV ("Quanto tá dando?") | J11 | O balcão usa 40×/dia |

---

# CONCLUSÃO

O sistema já **sabe** a resposta para cada problema crítico — detecta o caixa esquecido, calcula o limite de fiado, grava o fechamento de ontem, conhece o limite de desconto do funcionário, sabe quando o peso foi cancelado, sabe quando o produto está vencido. O que falta é a interface **agir sobre o que sabe**: bloquear quando deve, oferecer quando tem, gritar quando precisa e calar quando o operador só quer vender.

A persona do piloto não perdoa a interface que sabe e cala — ela perde dinheiro por silêncio e volta para o caderninho. E cada silêncio é um WhatsApp seu às 21h de sábado.

A base técnica é madura. O trabalho agora é o último metro entre o dado e a decisão: setas no ProdutoSearch, guard do scanner, peso cancelado que avisa, caixa que se bloqueia quando esquecido, fiado que fala antes, insight que executa, modo pallet que cadastra em 20s, e um PDV que responde à pergunta que o balcão mais faz.

O investimento único que move churn, suporte e boca-a-boca ao mesmo tempo é a Parte 0.4: **TTFV < 20 minutos** — primeiro login à primeira venda sem ajuda sua. Três ações do plano já entregam isso: Modo Pallet (J6), abertura-âncora de caixa (F4) e menu reduzido do piloto (A1). O resto defende o primeiro mês.

Nenhum arquivo de código foi modificado nesta análise.

---

# PARTE XIII — O JULGAMENTO COMO PRODUCT OWNER (o que as partes 0–XII não disseram)

As partes anteriores medem "em que lugar a tela falha". Esta parte julga se o sistema **é o produto que foi vendido**.

## 13.1 — A regra de negócio vende UMA promessa. A UI não a defende.

O que você vende ao piloto: **"em 2 meses você sabe exatamente o que está na prateleira e o que está sumindo"**. Ponto. Não é fiscal, não é maquininha, não é entrega — é *controle de estoque e de dinheiro*.

Teste essa promessa contra o que a tela mostra:

| O que o dono precisa SABER para a promessa ser verdade | Onde está hoje | Visível sem esforço? |
|---|---|---|
| O que está na prateleira | Produtos | ✅ |
| O que está SUMINDO (divergência sistema × prateleira) | Não existe tela | ❌ — é A promessa |
| O que entrou e não foi vendido (encalhe) | Relatórios, curva ABC | ❌, está longe |
| O que vence e se perde | Produtos → modal de vencidos | ⚠️ atrás de clique |
| O que ele vendeu hoje e para quem | Vendas | ⚠️ |

A tela que sustenta a sua promessa — **"o que sumiu esta semana: vendemos X, estoque diz X, a prateleira tem Y, a diferença é Z"** — **não existe no sistema**. O produto que você vendeu é "saber onde o dinheiro some"; a UI que existe mostra o que foi vendido, não o que sumiu. O inventário físico pelo próprio dono bipando está no plano de go-live — mas não há uma tela de "contagem cíclica": ele bipa a prateleira e o sistema diz "faltam 4 iogurtes". Sem ela, a única forma de saber o que some é fazer inventário total de 3h e comparar na calculadora. O piloto NÃO VAI FAZER — e aí a promessa dos "2 meses" não se cumpre e você perde o contrato por algo que não é bug, é **feature que sustenta a venda faltando**.

Esta é a peça mais importante que nenhuma das doze partes anteriores tocou — e é a razão pela qual "as telas estão todas OK" mesmo com um produto que falha na sua única promessa.

## 13.2 — O ERP abre no lugar errado: o dia do lojista começa no caixa, a aplicação começa no dashboard

O dia real do dono: 6h00 abrir o caixa → o dinheiro entra a partir daí. O dashboard é o **fim do dia** (olhar como foi), não o começo.

O que o sistema faz: qualquer usuário loga e cai no `/dashboard` (rota padrão de `getDefaultRoute`). O caixa nível 4 cai no `/pdv` (correto — `permissions.ts:139`) — mas **sem obrigar a abrir o caixa primeiro**. A prova: em `PDVPage.tsx:217,343,576` o PDV renderiza e deixa bipar mesmo com `caixaEstaAberto === false`; só impede na hora de finalizar, quando a venda já está montada.

Num ERP de nicho, a regra é o inverso: **não há PDV sem caixa aberto**. O operador não deveria nem conseguir escolher produto antes de o caixa estar aberto — a primeira tela do operador é "Abrir caixa", e o sistema não o deixa passar. Hoje ele vende, monta o carrinho todinho, e só descobre no fim que tinha que ter aberto. A ordem das ações é a ordem errada — e um ERP confiável começa o dia na obrigação certa, não num painel.

## 13.3 — Erro que a tarde real do mercadinho produz e que eu testei de happy path

Nenhuma das partes anteriores cobriu o que de fato quebra no sábado:

| A tarde real pergunta | O código responde |
|---|---|
| Duas caixas vendem o último iogurte ao mesmo tempo | ✅ `pdv.py:1080` `with_for_update` — lock pessimista correto |
| Internet cai ANTES de finalizar | ✅ `usePDV.ts:524` — enfileira offline |
| **Internet cai no MILISEGUNDO do clique em finalizar** | ✅ `usePDV.ts:532-533` — captura `ERR_NETWORK` e enfileira; uuid preserva idempotência |
| Funcionária sai no meio do turno e deixa a tela aberta | ⚠️ `useInactivityTimeout` desloga — mas o carrinho fica em `sessionStorage`. A próxima pessoa que usar o terminal herda o carrinho da que saiu — **vende no caixa da outra** |
| Impressora trava no fechamento | ⚠️ `printHtml` — falha silenciosa possível; relatório do dia pode não sair e ninguém nota |
| 2 caixas usam o mesmo tablet ao mesmo tempo | ❌ nada resolve o turno compartilhado: o "quem vendeu" sai errado |

Os dois primeiros erros da tabela (carrinho herdado e impressora que falha em silêncio) são falhas do **modelo, não da tela**: o carrinho deveria estar amarrado ao operador logado e limpar no logout/inatividade, e o fechamento deveria falhar ruidosamente se a impressão não sair (o dono vai embora sem o papel e só descobre à noite).

## 13.4 — O que um ERP bom faz e o seu não faz (benchmark honesto)

Sem olhar um TOTVS/CISS de verdade, o padrão do nicho é conhecido o suficiente para a comparação:

| Padrão de PDV maduro | Seu sistema |
|---|---|
| O turno é o objeto central: abre caixa → vende → fecha caixa. Tudo em torno | Caixa é uma função separada que o operador "lembra" de abrir |
| Não tem como vender sem caixa aberto | Pode montar a venda toda e só descobre no final |
| Teclado completo em TODA a operação | Setas não selecionam produto; quantidade/+/- sem atalho |
| Quando o caixa fica aberto além do turno, o sistema BLOQUEIA | Um texto amber de 12px |
| A abertura sugere o fechamento de ontem | Pede de memória |
| "Sistema, o que sumiu esta semana?" responde | Não existe a tela |

**Veredicto de PO:** o sistema está tecnicamente mais moderno que o incumbente (offline-first, lookup, IA) e operacionalmente atrás do que a função de caixa exige. Para um ERP, o segundo importa mais que o primeiro — o lojista não compra "funciona sem internet", compra "fecha o dia certo sem eu pensar".

## 13.5 — A única decisão que importa para o piloto

Se o piloto só pudesse ter UMA coisa pronta, não é nenhuma das 25 ações das partes anteriores — é a tela que responde: **"você vendeu X esta semana, mas o estoque caiu Y; a diferença é Z (4 iogurtes, 2 cafés, 1 azeite)"**. É a sua promessa de venda transformada em tela. Chame-a de "O que sumiu" — uma contagem cíclica rápida por seção da loja, com a bipagem no papel do dono, 20 minutos por semana.

É a única peça que, quando existir, faz o cliente dizer no fim dos 2 meses grátis: *"eu sei exatamente o que sumia e não sabia"* — e assinar.

Ela resolve 13.1 (a promessa), dá uso ao inventário físico que o plano de go-live já prevê, e é a única feature que nenhum PDV de nicho nesse preço entrega.

O resto das 25 ações são o que impede a operação diária de machucar a confiança até lá.
