# PLANO MESTRE DE IMPLEMENTAÇÃO — MercadinhoSys (piloto → produto)
## Consolidado de todas as análises da sessão + lacunas confirmadas por fonte externa

**Data:** 2026-10-31
**Para:** agente executor (outra sessão). Este plano é autocontido: cada item diz o que fazer, onde mudar, como validar e o critério de parada.
**Fontes:** `docs/ANALISE_UX_UI_PILOTO_2026-10-31.md`, `docs/RELATORIO_SM_PM_UX_PILOTO_2026-10-31.md`, `docs/CONTEXTO_SESSAO_UX_PILOTO_2026-10-31.md`, `docs/SPEC_O_QUE_SUMIU_CONTAGEM_CICLICA_2026-10-31.md`, e as lacunas confirmadas por fonte externa (impostos não calculados por regime, `calcular_giro_metrica` não chamado por task, alerta de estoque só estático, engine de regras ausente).

---

# LEI PRIMEIRA (lê antes de codificar qualquer linha)

1. **Não criar o que já existe.** Antes de qualquer piece, abrir o arquivo citado e confirmar que a função/rota/tela já não cobre o caso. Se cobrir, a peça vira integração, não criação.
2. **Backend primeiro, depois a tela, depois o teste de paridade.** Contrato fecha no servidor; o front consome e espelha a regra numa util de UI + teste Vitest com os mesmos vetores do pytest (padrão já usado na precificação-reversa).
3. **Guardião no dado, não no fluxo.** O dado entra com o mínimo; a revisão é em lote e depois. Nunca o contrário.
4. **Nenhum switch falso na tela.** Controle de configuração só entra na UI se o backend tiver o leitor real; senão não existe na tela.
5. **Teste prova o aceite, não o dev.** Cada item sai com o comando que o executa e o output esperado. Sem isso, o item não fecha.

---

# O QUE O PLANO É E O QUE ELE NÃO É

É o plano para **chegar ao go-live com a promessa cumprida** e **parar o sangramento operacional do primeiro mês**, em 4 fases de 1-2 semanas cada.

**NÃO está no plano** (fora de escopo e registrado para não assustar o piloto): NFC-e real em produção, integração TEF/maquininha, app mobile do dono, engine de regras DSL completa, sugestão de reposição por clima/feriados (sazonalidade simples por dia-da-semana/mês já entra na Fase 3), e qualquer cálculo de guia fiscal impresso.

---

# FASE 1 — "NÃO SE MACHUCA SOZINHO" (go-live seguro, ~9 pts)

Bloqueia as 4 falhas que explodem na primeira sexta com funcionário. **Go-live não acontece sem esta fase fechada.**

## 1.1 PDV bloqueado sem caixa aberto
**Por que:** `PDVPage.tsx:217,343,576` deixa montar o carrinho inteiro sem caixa e só avisa no F9.
**O que fazer:**
- Em `PDVPage.tsx`, no guard de `handleAbrirCheckout` e no botão de adicionar produto do `ProdutoSearch`, renderizar componente bloqueante quando `!caixaEstaAberto`: o PDV mostra só o botão "Abrir Caixa" e nada mais (sem busca, sem carrinho, sem tabs de sessão).
- Manter `CaixaManager` acessível. Ao abrir caixa, o bloqueio some.
**Valida:** `npx tsc --noEmit -p tsconfig.app.json`; teste manual: abrir PDV sem caixa → UI bloqueada; abrir caixa → PDV funciona.
**Critério de parada:** venda não pode ser montada sem caixa aberto — em nenhuma das 3 entradas (scanner, busca, teclas).

## 1.2 Caixa esquecido >14h vira modal bloqueante
**Por que:** `CaixaHeader.tsx:64,142-147` renderiza texto amber que ninguém lê.
**O que fazer:**
- No `PDVPage.tsx`, primeiro render com `caixaEsquecido` (reuse `CaixaHeader`'s logic) → modal full-screen bloqueante: "O caixa de QUARTA está aberto há 29h. [Fechar turno anterior agora (valor contado)] / [Continuar neste turno]".
- Ao escolher "Fechar": abre `CaixaManager` já na aba "fechar". Ao escolher continuar: grava a decisão com data/operador no audit.
**Valida:** teste manual com caixa criado >14h atrás (mudar `data_abertura` no banco de teste).

## 1.3 Abertura sugere o fechamento de ontem
**Por que:** `CaixaManager.tsx:242-276` pede de memória o valor que o sistema gravou.
**O que fazer:**
- Backend: novo endpoint leve `GET /caixas/ultimo-fechamento` retornando `saldo_final` do último caixa fechado do estabelecimento.
- Front (`CaixaManager.tsx` modal de abertura): exibir "Ontem o caixa fechou com R$ 347,50" + botões [Usar este valor] [Digitar outro]. Pré-preencher com o saldo sugerido.
**Valida:** pytest do endpoint (2 cenários: existe último fechamento / não existe); manual com 2 dias seguidos abrindo.

## 1.4 Trocar operador no mesmo tablet
**Por que:** `sessionStorage` é do navegador, não do operador — funcionária B vende "como" A (o "quem vendeu" sai errado).
**O que fazer:**
- O carrinho em `usePDV.ts` passa a ser keyado por operador: `pdv_sessions_v1_<funcionario_id>`.
- No `useInactivityTimeout`/`logout`, limpar a sessão do operador que saiu.
- Novo componente `TrocarOperadorModal` dentro de `CaixaHeader`: botão pequeno "Trocar operador" (só quando caixa aberto), pede PIN + novo login rápido (endpoint de login de operador, já existe o fluxo de auth). Na troca: carrinho do antigo é limpo e o novo vê tela vazia; o caixa segue aberto (é o turno, não o operador).
**Valida:** manual com 2 operadores e o mesmo tablet — venda de B sai com `funcionario_id` de B, não de A (checar `Auditoria.usuario_id`).

## 1.5 Peso cancelado avisa alto
**Por que:** `PesoInputModal.tsx:36-44` + `PDVPage.tsx:472-477` perdem a venda em silêncio.
**O que fazer:**
- Em `PDVPage.tsx` `onClose` do `PesoInputModal`: `showToast.error(<nome> NÃO adicionado — bipe novamente para vender", duration: 6000, icon: '⚠️')`.
- Alternativa melhor (escolher 1): adicionar o item ao carrinho com `quantidade: 0` e estado pendente (linha amarela piscando) até peso confirmado.
**Valida:** bipar granel → cancelar → toast exibido OU item pendente visível.

## 1.6 Parser único de data de validade
**Por que:** 3 parsers divergentes — `ProdutoSearch.tsx:129` entende ISO, `usePDV.ts:305` e `CarrinhoItem.tsx:184` não, e `NaN < hoje` deixa o vencido entrar.
**O que fazer:**
- Novo `src/utils/validade.ts`: `parseDataValidade(input: string): Date | null` aceitando ISO `YYYY-MM-DD[T...]`, `YYYY-MM-DD` e `DD/MM/YYYY`. Vazio/inválido → `null` (nunca `NaN`).
- Refatorar os 3 pontos para usar. Em `usePDV.adicionarProduto`, `null` = sem bloqueio (produto sem data), em vez de NaN que deixa passar.
**Valida:** Vitest com os 3 formatos + um inválido; teste do usePDV: produto com data ISO vencida → toast bloqueante.

## 1.7 Desconto respeita o limite configurado
**Por que:** `usePDV.ts:455-462` (`validarDescontoPermitido`) existe mas `aplicarDescontoItem` não a chama.
**O que fazer:**
- Em `aplicarDescontoItem`, antes de aplicar: chamar `validarDescontoPermitido`; acima do limite → `PinDialog` (já existente) exigindo autorização de gerente/admin (o mesmo fluxo que Produtos usa para edição/descarte).
- Se autorizado: aplica e registra `Auditoria` com `usuario_id` do autorizador.
**Valida:** Vitest: role CAIXA + limite 10% + desconto 40% → bloqueado com pedido de PIN; role ADMIN → aplica direto.

## 1.8 Estorno por item: volta ao estoque OU vira perda
**Por que:** `SalesPage.tsx:636` devolve tudo ao estoque, inclusive o aberto/mordido.
**O que fazer:**
- Backend (rota de cancelamento em `vendas.py`): payload aceita `itens_perda: [produto_id...]`. Itens nessa lista: vão para `MovimentacaoEstoque` tipo `saida` motivo "Perda em cancelamento de venda"; o resto: volta ao estoque como hoje.
- Front (modal de cancelamento): por item da venda, dois botões grandes [Volta ao estoque] [Vai para perda]. Default: lacrado/NF → volta; perecível/granel → perda.
**Valida:** pytest: cancelar venda de 3 itens com 1 marcado perda → estoque do perda reduz, demais voltam, 2 movimentações criadas com motivos distintos.

## 1.9 Auditoria sempre com usuario_id + falha visível
**Por que:** `clientes.py:1013` grava NULL conforme formato do JWT; `models.py:2470` engole erro com `except: pass`.
**O que fazer:**
- `Auditoria.registrar()`/`registrar_direto()`: remover o `except: pass` → `current_app.logger.error(...)` com o payload que falhou (falha na trilha nunca é silenciosa).
- `clientes.py:1013`: resolver `usuario_id` pelo JWT (`get_jwt_identity()`), não por parse do username.
- Migration leve: `usuario_id` continua NULLable no schema (eventos do sistema existem), mas toda rota que escreve passa o operador.
**Valida:** pytest: excluir cliente logado como email → linha de auditoria com `usuario_id` preenchido.

**Saída da Fase 1:** o sistema **não se machuca sozinho**; o primeiro fechamento com funcionário não explode. Gate: 9 itens com validação verde + `npx tsc` limpo + pytest do backend verde.

---

# FASE 2 — "APRENDE SEM MIM" (TTFV, ~8 pts)

O piloto faz a primeira venda em <20 minutos sem você. Vende o próximo cliente por boca-a-boca.

## 2.1 Modo Pallet (cadastro de 200 itens em ~1h, não 5h)
**Por que:** `ProductFormModal.tsx` exige 5 campos obrigatórios mesmo com lookup perfeito → 5 horas em pé, desistência no 5º.
**O que fazer (guardião no dado, não no fluxo):**
- Novo modo alternativo dentro de `ProductsPage.tsx`: "Entrada rápida (pallet)". UI: bipa → o lookup do BDC preenche como hoje → só 2 campos obrigatórios na tela (preço de venda, quantidade) → `Salvar e próximo` → foco volta ao scanner.
- O que não foi preenchido: subcategoria oficial inferida pelo NCM quando possível (heurística já existe no BDC service); quando não, o item vai com flag `revisar_categoria: true` e aparece na Lista de Revisão do dono.
- Estoque-zero consciente mantém (é a regra do guardião).
- Rótulos: botões grandes "Salvar e próximo (Enter)" / "Abrir completo" (vai ao ProductFormModal tradicional).
**Valida:** cadastrar 3 itens fictícios por bipagem: item com EAN conhecido, item sem EAN (código interno 20), item com EAN desconhecido — todos salvos; o sem-subcategoria aparece em Revisão.
**Critério de parada:** ≤ 20s/item medido na prática.

## 2.2 Menu por persona do piloto
**Por que:** `Sidebar.tsx:44-58` mostra SFA/Delivery/RH completo para dono+1 caixa; o dono nível 1 vê tudo.
**O que fazer:**
- O `menuItems` passa a ser computado por `getMenuForUser(user)`: se o estabelecimento tem apenas 1 estabelecimento e usuário nível 1-2 → mostrar só: Dashboard, PDV, Gerenciar Caixa, Produtos, Clientes, Despesas, Vendas, Relatórios, Entrada de Nota, e "Mais".
- "Mais": submenu com o resto (visível mas não na face). BottomNavigation espelha a mesma lista.
- Super admin e modo espelho continuam vendo tudo.
**Valida:** login como dono do piloto → menu com 9 itens; login como super admin → menu completo.

## 2.3 Onboarding executável (não tour de 13 passos)
**Por que:** `TourExecutivo.tsx` explica e não executa; quem pede ajuda para abrir caixa recebe SFA.
**O que fazer:**
- Substituir o tour da primeira semana por `OnboardingPiloto.tsx`: 4 cards em sequência fixa:
  1. "Abrir meu caixa" → abre o CaixaManager com saldo sugerido de ontem (Fase 1.3)
  2. "Cadastrar meu primeiro produto" → abre scanner no modo Pallet (Fase 2.1)
  3. "Fazer minha primeira venda" → guia no PDV com 1 item
  4. "Fechar meu caixa" → guia no fechamento
- Cada card tem botão que FAZ (não explica), estado "feito" persistente por estabelecimento, e o 4º termina com "Você completou o primeiro dia! 🎉".
- O tour antigo continua acessível pelo botão "Tour & Ajuda" — mas deixa de ser a porta de entrada.
**Valida:** 1 tenant novo em sandbox: login → 4 cards → 4 ações → TTFV medido.

## 2.4 Dashboard "Hoje" com ação
**Por que:** `DashboardPage.tsx:23` default 30 dias esconde o ontem; cards sem ação embutida.
**O que fazer:**
- `daysFilter` default vira `1` (Hoje).
- Top 3 alertas operacionais acima dos gráficos: "X produtos com giro>0 e estoque 0 → [Repor agora]" (deep-link `openAdjustFor`), "Y clientes com fiado vencido ontem → [Cobrar no WhatsApp]" (wa.me pronto), "Caixa aberto há >14h → [Resolver]" (abre o CaixaManager).
**Valida:** manual com dados de seed — o dono abre às 7h e vê as 3 perguntas respondidas sem clicar.

## 2.5 PIN nos pontos de uso
**Por que:** `SalesPage.tsx:653` não diz onde o PIN se configura.
**O que fazer:**
- Todo lugar que pede PIN (SalesPage cancelamento, ProductsPage descarte/edição, futuro sangria): texto ao lado "Não sei meu PIN → Configurar" com deep-link `/settings?tab=vendas&pin=1`.
- A seção PIN sai de "Sistema & Segurança" e vai para `Vendas & PDV` (lugar onde é usada).
**Valida:** manual: no cancelamento, clicar no link cai na aba certa com a seção PIN aberta.

**Saída da Fase 2:** TTFV < 20 minutos medido na prática com um usuário novo. Gate: 5 itens com validação verde + suíte verde do front (`npx vitest run`).

---

# FASE 3 — "O QUE SUMIU" (a promessa, ~5 pts) + lacunas do backend confirmadas

## 3.1 A tela "O que sumiu" (SPEC completa já escrita)
**Fonte:** `docs/SPEC_O_QUE_SUMIU_CONTAGEM_CICLICA_2026-10-31.md` — modelo, API, UX, erros previstos, aceite.
**O que fazer:** implementar exatamente a spec (2 tabelas, 6 endpoints, 1 página mobile-first com as 3 telas internas). Nada mais crie: a spec já fechou escopo.
**Valida:** os 5 critérios de aceite da spec, na ordem.

## 3.2 Insight da IA com ação
**Por que:** `rag.py:15` bloqueia, backend devolve 3 strings, front renderiza só texto.
**O que fazer:**
- Backend (`consultor.py:gerar_insights`): o prompt pede agora JSON `[{tipo, texto, acao: {tipo, payload}}]` — com tipos de ação conhecidos: `repor`, `cobrar`, `promocionar`, `ver_contagem`.
- Front (`InsightCard.tsx`): cada bullet de `action` renderiza o botão correspondente via deep-link existente (`ProductsPage` recebe `openAdjustFor`; `ExpiringProductsModal` abre por state; wa.me pronto).
- Regras anti-injeção mantidas (a IA **abre o formulário preenchido**, o humano autoriza).
**Valida:** 1 insight mock com ação `repor` → botão abre o ajuste do produto preenchido; insight sem ação → renderiza como texto como hoje (compatível).

## 3.3 Alerta de estoque por giro (a lacuna confirmada, mínima)
**Por que:** `calcular_giro_metrica` existe e nenhuma task o chama; o único alerta é `estoque <= quantidade_minima` (`estoque/tasks.py`).
**O que fazer (mínimo, sem sazonalidade sofisticada):**
- Task diária `estoque_reposicao`: para cada produto ativo com vendas nos últimos 30d, calcula `cobertura_dias = quantidade / (VMD_30d)`. Se `cobertura_dias < 5` → alerta (não quando só bate o mínimo).
- Ajuste contextual simples já com dados locais: sexta/sábado (`weekday >= 4`) multiplica urgência de bebidas (cerveja/refrigerante) por 0.7; dezembro/janeiro multiplica panetone/champanhe por 0.5. Sem APIs externas ainda.
- **Não cria um novo evento:** escreve no mesmo destino do alerta atual (o painel de alertas) para não duplicar.
**Valida:** produto fictício com alta saída nas sextas → task de quinta gera alerta mais urgente que a de segunda (medir `cobertura_dias` apresentado).

## 3.4 Cálculo fiscal por regime (a lacuna confirmada do imposto — mínimo correto)
**Por que:** produto guarda `icms_aliquota/pis_aliquota/cofins_aliquota`, mas nada zera/ajusta por `regime_tributario`; para MEI/Simples o valor real é outro (DAS). O lojista hoje calcula na planilha.
**O que fazer (escopo mínimo e correto, sem virar motor fiscal):**
- Novo `services/fiscal/calculo_venda.py`: `calcular_impostos_venda(estabelecimento_id, itens)`:
  - `SIMPLES NACIONAL` / MEI: **0 nos campos por-item** (ICMS/PIS/COFINS são do DAS mensal, não por venda) + marca `imposto_calculado_por: 'simples_das_a_confirmar'`.
  - `LUCRO PRESUMIDO`/`REAL`: usa as alíquotas do produto + o cst_icms/cfop_padrao, soma por item e por documento.
- Na rota `finalizar_venda` (pdv.py e vendas.py — os dois caminhos), chamar e gravar `venda.imposto_estimado_total`, `venda.icms_estimado`, `venda.pis_estimado`, `venda.cofins_estimado` (migration aditiva, default 0 para legado).
- O cupom e o relatório mostram os valores **com selo "estimado"** (o número real depende da receita acumulada no mês — o sistema calcula a estimativa, não a guia).
**Valida:** pytest:
- Estabelecimento Simples + produto csosn 102 + venda R$ 100 → estimados = 0 e `imposto_calculado_por` marcado.
- Estabelecimento Real + alíquotas 18/1.65/7.6 nos itens → estimados corretos na soma.
**Critério de parada explícito:** se a validação não passar em 2h de trabalho nesta peça, abortar a peça e registrar — o piloto não depende dela (está fora do plano comercial).

**Saída da Fase 3:** a tela que decide o contrato (3.1), a IA que trabalha (3.2), reposição por giro (3.3) e o imposto estimado honesto (3.4). Gate: aceite da spec + testes das 3 lacunas + deploy validado.

---

# FASE 4 — PÓS-PILOTO (registrado para não confundir com o resto)

- Engine de regras DSL em `configuracoes_json` (verificada ausente) — escopo próprio, com DSL pequena e editor no superadmin. Depende de tudo estar em produção estável primeiro.
- Sugestão de reposição com clima/feriados (APIs externas) — expande a 3.3 depois de 4-6 semanas de dados reais.
- Teclado completo no PDV (setas/Enter no ProdutoSearch + shortcuts para +/-/remover) — já está no backlog; entra na primeira folga do Sprint 1-2 se sobrar ponto, ou na primeira versão pós-piloto.
- Balança (parser de EAN 2+PLU+peso) — já verificada ausente; entra se o piloto tiver frios; senão, fase de nicho específico.
- Visual (emerald no "Concluir Venda", badges ≥12px, `cor_principal` wireado) — só depois da Fase 2, se a operação permitir.

---

# ORDEM DE EXECUÇÃO PARA O AGENTE (a lista exata)

Semana 1 (Fase 1.1-1.5), Semana 2 (Fase 1.6-1.9), Semana 3 (Fase 2.1-2.3), Semana 4 (Fase 2.4-2.5) — **Go-live no fim da semana 4 com a aplicação de Fase 1 verificada**. Semana 5 (Fase 3.1 + deploy), Semana 6 (Fase 3.2-3.4 + review). Fase 4 quando o piloto estiver pagando.

**Cada item sai com:**
1. O commit pequeno e convencional (`feat(pdv): bloqueia carrinho sem caixa aberto`)
2. O teste que prova (pytest ou Vitest, com o comando e o output esperado)
3. O gate barato antes do próximo item (`npx tsc --noEmit` no front, `pytest tests/test_<modulo>.py -q` no back)

**E uma regra dura para o agente:** quando o item 1.1 fechar, o agente **para** e mostra o output verde antes de abrir o 1.2 — e assim por diante. Nenhuma fase avança com item em aberto. O usuário cobrou isso de mim 4 vezes nesta sessão; o agente não precisa ouvir a mesma cobrança.

*Plano pronto. Nenhuma linha de código foi escrita.*
