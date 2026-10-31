# PLANO DE EXECUÇÃO — MERCADINHOSYS (Piloto → Produto)
## Documento de entrada para o agente executor. Versão corrigida e verificada contra o código.

**Data:** 2026-10-31
**De:** Scrum Master
**Para:** Agente executor (vai codar com este documento como escopo)
**Aprovador:** CTO (Rafael) — decide go-live e escopo
**Base de evidência:** análise de UX/UI do piloto (`docs/ANALISE_UX_UI_PILOTO_2026-10-31.md`) + verificação de código feita por outra sessão em 31/10 11:45-11:55.

---

# ⚠️ LEIA ANTES DE CODAR — SITUAÇÃO REAL DO REPO AGORA (31/10 11:55)

**Existe outra sessão de agente codando neste repo CONCOMITANTE.** Antes de editar qualquer arquivo, rode:

```bash
cd C:/Users/rafae/Dev/mercadinhosys
git status --porcelain | grep -v desktop.ini
git log --oneline -3
```

**Trabalhos já FEITOS (não reimplementar):**

| Item | Onde | Estado |
|---|---|---|
| FASE 1.1 — PDV bloqueado sem caixa aberto | commit `8b2ba9d7` | ✅ **COMMITADO, mas NÃO PUSHADO** (1 commit à frente do origin/master) |
| FASE 1.2 — Modal bloqueante caixa >14h | commit `8b2ba9d7` | ✅ commitado, não pushado |
| FASE 1.5 — Toast peso cancelado | commit `8b2ba9d7` | ✅ commitado, não pushado |
| FASE 1.3 — Abertura sugere fechamento de ontem | `backend/app/routes/caixas.py` + `CaixaManager.tsx` + `backend/tests/test_caixas_ultimo_fechamento.py` | 🔄 **EM ANDAMENTO AGORA** (arquivos modificados 11:40-11:45). pytest: **4 passed** |
| FASE 1.6 — Parser único `utils/validade.ts` | `frontend/mercadinhosys-frontend/src/utils/validade.ts` + `.test.ts` | 🔄 **EM ANDAMENTO AGORA** (11:45-11:56). **1 de 3 pontos integrado** (`usePDV.ts` importa `parseDataValidade` desde 11:56). `ProdutoSearch.tsx:136` e `CarrinhoItem.tsx:185` **ainda usam parser próprio** — falta integrá-los |

**Arquivos untracked que precisam ser versionados (hoje estão só no disco):**
```
docs/ANALISE_UX_UI_PILOTO_2026-10-31.md
docs/CONTEXTO_SESSAO_UX_PILOTO_2026-10-31.md
docs/PLANO_MESTRE_IMPLEMENTACAO_2026-10-31.md
docs/RELATORIO_SM_PM_UX_PILOTO_2026-10-31.md
docs/SPEC_O_QUE_SUMIU_CONTAGEM_CICLICA_2026-10-31.md
frontend/mercadinhosys-frontend/src/utils/validade.ts
frontend/mercadinhosys-frontend/src/utils/validade.test.ts
backend/tests/test_caixas_ultimo_fechamento.py
```
> Se a sessão morrer, tudo isso vai junto. **PRIMEIRO TRABALHO DO AGENTE: `git add` desses paths explícitos + commit.**

**LIXO NO WORKING TREE (NÃO commitar — junk do Explorer/Windows):**
`frontend/mercadinhosys-frontend/preview-form.html`, `src/__preview/`, `src/__schema_mock.json`, `scripts/auditoria/` (artefato de auditoria, confirmar com o CTO antes).

**Regra de ouro desta execução:** nunca `git add .` — sempre lista explícita de paths.

---

# LEI PRIMEIRA (vale para TODOS os itens)

1. **Não criar o que já existe.** Antes de cada item, abrir o arquivo citado e confirmar que a função/rota/tela não cobre o caso. Se cobrir, a peça vira **integração**, não criação.
2. **Backend primeiro → tela → teste de paridade.** O contrato fecha no servidor; o front consome e espelha a regra numa util de UI + teste Vitest com os **mesmos vetores** do pytest.
3. **Guardião no dado, não no fluxo.** O dado entra com o mínimo; a revisão é em lote e depois.
4. **Nenhum switch falso na tela.** Controle de configuração só entra na UI se o backend tiver o leitor real.
5. **Teste prova o aceite, não o dev.** Cada item sai com o comando que o executa e o output esperado.
6. **Uma coisa por commit.** Commit pequeno e convencional: `feat(pdv): ...` / `fix(caixas): ...` / `test(estoque): ...`.
7. **PARE ao fechar cada item** e mostre o output verde. **Não abra o item seguinte sem o OK do CTO.**

---

# FASE 1 — "NÃO SE MACHUCA SOZINHO" (go-live seguro)

Objetivo: o primeiro fechamento com funcionário não explode.

## 1.0 [PRIMEIRO] Blindar o trabalho já feito — commit + push

**Por que:** `8b2ba9d7` (bloqueio de caixa, modal 14h, toast de peso) está commitado mas **não pushado**. Os 5 documentos e 3 arquivos de código estão **untracked**. Risco real de perder a sessão inteira.

**O que fazer:**
1. `git add` da lista explícita acima (docs + `utils/validade.*` + `tests/test_caixas_ultimo_fechamento.py`) — **só depois** de confirmar que a outra sessão terminou e que o código dela está verde.
2. Commit dos docs: `docs(analise): consolidate UX/UI do piloto + plano mestre + spec de contagem ciclica`
3. Commit do `utils/validade.*` + `test_caixas_ultimo_fechamento.py` **só se** os testes passarem.
4. `git push` da branch `8b2ba9d7` + abrir PR para `master`.

**Valida:** `git log --oneline -5` mostra os commits; `git ls-remote --heads origin` mostra a branch; PR aberto com CI rodando.
**Critério de parada:** nada disso avança se a outra sessão ainda estiver escrevendo nos mesmos arquivos.

---

## 1.1 [FEITO — `8b2ba9d7`] PDV bloqueado sem caixa aberto

`PDVPage.tsx:164` `const bloqueioCaixa = !caixaAberto && !loading` → `:544` renderiza `<CaixaBloqueado>` (só o botão "Abrir Caixa"; sem busca, sem carrinho, sem tabs). `ProdutoSearch` recebe `disabled={!caixaEstaAberto}` (`:591`).

**Ação:** apenas entregar no PR (item 1.0). **Não reimplementar.**

---

## 1.2 [FEITO — `8b2ba9d7`] Caixa esquecido >14h vira modal bloqueante

`PDVPage.tsx:167-168` estado `caixaEsquecidoModal` + `caixaEsquecidoResolvido`. Botão "Fechar turno anterior" abre o `CaixaManager`; "Continuar" grava a decisão.

**Ação:** entregar no PR. Não reimplementar.

---

## 1.3 [EM ANDAMENTO] Abertura sugere o fechamento de ontem

**Já feito (verificado no disco 31/10 11:44):**
- `backend/app/routes/caixas.py` — rota `GET /caixas/ultimo-fechamento` (`@jwt_required()` + `@permission_required('gestao_caixa')`), retorna `saldo_final` do último caixa com `status="fechado"` ordenado por `data_fechamento DESC`.
- `frontend/.../CaixaManager.tsx` — banner "Ontem o caixa fechou com R$ X" + botão "Usar este valor" que preenche `saldoInicial`.
- `backend/tests/test_caixas_ultimo_fechamento.py` — 4 testes, **4 passed** (rodado agora).

**O que FALTA (se a outra sessão não fechar):**
1. Rodar a suíte do backend inteira (`backend/venv/Scripts/python.exe -m pytest tests/ -q`) — 4 testes verdes não provam que nada quebrou.
2. Rodar `npx tsc --noEmit -p tsconfig.app.json` no front.
3. Confirmar que `saldo_final` pode ser `None` (caixa fechado sem saldo final gravado) — o front usa `ultimoFechamento.saldo_final.toFixed(2)` em `CaixaManager.tsx:263` → **se `saldo_final` for null, quebra em runtime**. Blindar: `saldo_final != null ? ... : null` no backend e guarda no front.
4. Commitar.

**Valida:** pytest da suíte + tsc limpo.
**Critério de parada:** se a suíte do backend não estiver verde, PARAR e reportar — não seguir para 1.4.

---

## 1.4 Trocar operador no mesmo tablet

**Por que:** o carrinho do PDV vive em `sessionStorage` (`usePDV.ts:75` `PDV_STORAGE_KEY = 'pdv_sessions_v1'`), que é **do navegador, não do operador**. A funcionária B herda o carrinho da A e vende "como" A → o "quem vendeu" sai errado (problema de RH e de confiança).

**O que fazer:**
1. **Keyar a sessão por operador.** Em `usePDV.ts`, trocar a chave fixa por uma chave derivada do(funcionalário): `pdv_sessions_v1_<funcionario_id>`. O `funcionario_id` já vem em `configuracoes.funcionario.id` (`routes/pdv.py:431`).
   - Cuidado: `pwa/updateManager.ts:32` também referencia `'pdv_sessions_v1'` — **ler esse arquivo** e ajustar a lista de chaves que ele preserva, senão o update do PWA limpa a sessão do operador.
   - Cuidado: `authService.ts:227` também referencia `'pdv_sessions_v1'` — **ler** e ajustar o clear no logout.
2. **Limpar no logout/inatividade.** Ao desmontar a sessão por timeout, limpar só a chave do operador que saiu.
3. **Botão "Trocar operador"** no `CaixaHeader` (só quando há caixa aberto): abre um modal pedindo PIN de admin + login rápido do novo operador. Ao trocar: o carrinho do antigo é **descartado** e o novo vê tela vazia; o caixa **segue aberto** (o caixa é do turno, não do operador).
   - Reaproveitar o modal de PIN existente: `frontend/mercadinhosys-frontend/src/components/modals/PinDialog.tsx` (valida via `settingsService.verifyPin(pin)`).
   - Reaproveitar o fluxo de login de operador existente (`features/auth/`).

**Valida:**
- Vitest: trocar de operador limpa a chave `pdv_sessions_v1_<id>` do antigo e a nova começa vazia.
- Manual: 2 operadores no mesmo tablet → venda de B sai com `funcionario_id` de B (conferir em `Auditoria`/`Venda.funcionario_id`).
**Critério de parada:** se o login rápido de operador não existir no backend, PARAR e reportar — não inventar um mecanismo de identidade paralelo.

---

## 1.5 [FEITO — `8b2ba9d7`] Peso cancelado avisa alto

`PDVPage.tsx:517-528` — `onClose` do `PesoInputModal` dispara `showToast.error("<nome> NÃO adicionado — bipe novamente para vender")`, e `handleConfirmarPeso` fecha o modal **sem** disparar o toast (bug corrigido no mesmo commit).

**Ação:** entregar no PR. Não reimplementar.

---

## 1.6 [EM ANDAMENTO — INTEGRAÇÃO FALTA] Parser único de data de validade

**Já feito (verificado no disco 31/10 11:45-11:56):**
- `frontend/mercadinhosys-frontend/src/utils/validade.ts` — `parseDataValidade()` / `estaVencido()` / `diasParaVencer()`, aceita `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm` e `DD/MM/YYYY`, **nunca devolve NaN** (valida coerência de dia/mês/ano).
- `frontend/mercadinhosys-frontend/src/utils/validade.test.ts` — testes dos formatos.
- `hooks/usePDV.ts` — **JÁ INTEGRADO** (11:56): importa `parseDataValidade` e trata `null` como "sem data = não bloqueia".

**O que FALTA (a parte que importa):** os outros **2 pontos** continuam com parser próprio:
- `features/pdv/components/ProdutoSearch.tsx:131-140` — parser ISO-`T` inline
- `features/pdv/components/CarrinhoItem.tsx:184-188` — parser `-`/`/` inline

> ⚠️ **A outra sessão está escrevendo NESTES arquivos agora.** Antes de editar `ProdutoSearch.tsx` / `CarrinhoItem.tsx`, rode `git status --porcelain` e confirme que ela parou. Editar o mesmo arquivo ao mesmo tempo perde trabalho.

**Por que importa mesmo sendo hardening:** o backend hoje devolve `YYYY-MM-DD` (`data_validade` é `db.Column(db.Date)` em `models.py:1162`; `SerializableMixin.to_dict` em `models.py:258` usa `iso_utc` → `date.isoformat()`), então o bug do `NaN` **não acontece no caminho normal**. Mas `routes/pdv.py:626` e `:818` fazem `str(produto_data.get("data_validade"))` — e qualquer caminho que passe por cupom/offline (`usePDV.ts` monta o payload do cupom local) pode entregar ISO com `T`. **A integração é obrigatória para fechar o item; o arquivo sozinho não conta.**

**O que fazer:**
1. Refatorar os 3 pontos para `import { parseDataValidade, estaVencido, diasParaVencer } from '../../utils/validade'` (ajustar o caminho relativo de cada arquivo).
2. Em `usePDV.adicionarProduto`: `const d = parseDataValidade(produto.data_validade); if (controlarValidade && d && d < hoje) { toast; return false; }` — **`null` = produto sem data = não bloqueia** (diferente do `NaN` atual, que comparava `false` e deixava passar silenciosamente).
3. `ProdutoSearch.getValidadeBadge` usa `diasParaVencer(dvStr)` para o badge.
4. `CarrinhoItem` usa `estaVencido(produto.data_validade)` para o badge de vencido.

**Valida:**
- `npx vitest run` verde (inclui `utils/validade.test.ts`).
- Vitest do `usePDV`: produto com data ISO **vencida** → toast bloqueante e **não** entra no carrinho.
**Critério de parada:** se algum dos 3 arquivos for grande demais para refatorar com segurança, pare e reporte — não deixe metade.

---

## 1.7 Desconto: o backend já segura — o front precisa avisar ANTES

> ⚠️ **Correção ao plano mestre original.** A versão anterior deste plano dizia "o desconto do caixa ignora o limite configurado do funcionário" e pedia PIN de gerente. **Isso está errado.** O backend já segura o desconto nos DOIS caminhos de venda.

**O que o código já faz (verificado):**
- `backend/app/utils/checkout_locking.py:76-103` — `validate_pricing(user, items, discount, tenant_id)`:
  - `limit = min(limite do funcionário via permissoes_json, config.desconto_maximo_percentual, config.desconto_maximo_funcionario)` (linha 88)
  - recalcula `catalog_total` (preço de catálogo) vs `charged` (preço cobrado) — **não confia no total do cliente**
  - `raise ValueError('Desconto excede a permissão do operador e o limite da loja')` (linha 103)
- Chamado em `backend/app/routes/pdv.py:894-895` (`POST /pdv/finalizar`) **e** `backend/app/routes/vendas.py:828-829` (`POST /vendas/`).

**O problema real (2 defeitos, nenhum é "sem freio"):**

**Defeito A — o front não avisa antes; a venda quebra no F9.**
`hooks/usePDV.ts:435-453` `aplicarDescontoItem` aplica o desconto **sem** consultar `validarDescontoPermitido` (`:455-462`). O operador monta a venda inteira, digita o pagamento, aperta F9 e **só então** recebe o 400 — com a fila esperando. `PDVPage.tsx:366-374` só trata o 403 `CAIXA_FECHADO`; o resto do erro é engolido ("Outros erros já tratados pelo promise").

**Defeito B — os dois limites divergem.**
- O backend usa `min(funcionario.limite_desconto, config.desconto_maximo_percentual, config.desconto_maximo_funcionario)`.
- O front (`usePDV.ts:460`) lê **só** `configuracoes.funcionario.limite_desconto`, que vem de `routes/pdv.py:435` → `permissoes.get("limite_desconto", 0)` do `permissoes_json` do funcionário — **e, no fallback, é hardcoded `10`** (`routes/pdv.py:327`).
- `config.desconto_maximo_percentual` e `config.desconto_maximo_funcionario` **existem** no `Configuracao` (`models.py:507-508`, default 10.00), **são editáveis na tela** (`features/settings/SettingsPage.tsx:930-937`) e **já chegam ao front** em `types/index.ts:524` — mas **não** em `/pdv/configuracoes`.

**O que fazer:**
1. **Backend:** em `routes/pdv.py:429-437` (bloco `configuracoes["funcionario"]`), incluir o limite efetivo da loja no payload:
   ```python
   "limite_desconto_loja": float(cached_config.get("desconto_maximo_funcionario", 10.0)),
   ```
   (o `cached_config` já carrega `desconto_maximo_funcionario` — `utils/query_helpers.py:403-404` confirma).
2. **Front:** em `usePDV.ts:455-462`, calcular o limite como o backend faz:
   ```ts
   const limiteDesconto = Math.min(
       configuracoes.funcionario.limite_desconto || 0,
       configuracoes.funcionario.limite_desconto_loja ?? 100,
   );
   ```
   e em `aplicarDescontoItem` (`:435`), **antes** de aplicar: se `!validarDescontoPermitido(percentual)`, mostrar toast de erro **e não aplicar** — o operador descobre antes de montar a venda.
3. **Tipar** o novo campo em `features/pdv/pdvService.ts:12-18` (interface `funcionario`).
4. **Tornar o erro do F9 visível:** em `PDVPage.tsx:366-375`, tratar o 400 de desconto com toast explícito ("Desconto acima do seu limite — peça autorização do gerente"), para o caso do cliente enviar payload antigo ou o limite mudar no meio da venda.

**Valida:**
- Vitest: role CAIXA + `limite_desconto` 10% + `limite_desconto_loja` 10% → desconto de 40% **não é aplicado** e o toast aparece.
- Vitest: role ADMIN → aplica direto.
- pytest: `validate_pricing` continua rejeitando (não regredir o backend).

**Critério de parada:** se `permissoes_json` do funcionário não tiver `limite_desconto` no piloto (retorna 0), o front vai bloquear TODOS os descontos — nesse caso, tratar `0` como "sem limite explícito do funcionário" e deixar o limite da loja valer. **Testar com o usuário real do piloto antes de fechar.**

---

## 1.8 Estorno por item: volta ao estoque OU vira perda

**Por que:** `SalesPage.tsx:636` — o cancelamento devolve **tudo** ao estoque, inclusive o leite aberto que voltou do cliente. O item volta vendável, o inventário não bate e o dono perde a diferença sem nunca saber.

**O que fazer:**
1. **Backend** (`routes/vendas.py`, rota de cancelamento ~linha 1191): aceitar payload `{"itens_perda": [produto_id, ...]}`.
   - Item em `itens_perda` → `MovimentacaoEstoque` tipo `saida`, motivo `"Perda em cancelamento de venda"`, `quantidade_anterior`/`quantidade_atual` preenchidos (o model já tem os campos: `models.py:1910-1932`).
   - Os demais itens → voltam ao estoque como hoje.
   - `venda_id` e `funcionario_id` preenchidos; `usuario_id` = o operador logado (ver item 1.9).
2. **Front** (modal de cancelamento em `SalesPage.tsx`): por item da venda, dois botões grandes **[Volta ao estoque]** **[Vai para perda]**. Default: item lacrado/NF → volta; perecível/granel → perda.
3. **DRE:** o relatório já lê `MovimentacaoEstoque` — verificar que a saída por perda aparece como perda (não como venda) antes de fechar.

**Valida:** pytest — cancelar uma venda de 3 itens com 1 marcado como perda → o estoque do item-perda reduz, os outros 2 voltam, e existem 2 movimentações com motivos distintos.

---

## 1.9 Auditoria sempre com `usuario_id` + falha visível

**O que existe (verificado):**
- `backend/app/models.py:2470-2471` — `Auditoria.registrar_direto`: `except Exception as e: pass` → **falha silenciosa**.
- `backend/app/models.py:2474-2485` — `Auditoria.registrar`: loga o erro e **retorna False** sem levantar (aceitável, mas o chamador ignora o retorno).
- `backend/app/routes/clientes.py:1016` — `usuario_id=int(username) if str(username).isdigit() else None` → **com login por e-mail, o `usuario_id` vira NULL**.

**O que fazer:**
1. `models.py:2470` — trocar `pass` por `current_app.logger.error(f"Auditoria direto falhou: {e}", exc_info=True)`.
2. `clientes.py:1016` — resolver o operador pelo JWT (`get_jwt_identity()`), não por parse do username. **Ler o contexto da rota antes** (o `username` pode estar sendo usado por outro motivo ali).
3. Auditar os **outros** chamadores de `Auditoria.registrar` que passam `usuario_id` derivado de string — grep `usuario_id=` no backend e corrigir os que puderem dar NULL com e-mail.

**Valida:** pytest — excluir cliente logado com e-mail → a linha de auditoria tem `usuario_id` preenchido (não NULL).

---

**Saída da Fase 1:** o sistema **não se machuca sozinho**. Gate: todos os 9 itens com validação verde + `npx tsc --noEmit` limpo + suíte do backend verde.

---

# FASE 2 — "APRENDE SEM MIM" (TTFV < 20 minutos)

Objetivo: o primeiro cliente faz a primeira venda sem ajuda do CTO.

## 2.1 Modo Pallet (cadastrar 200 itens em ~1h, não 5h)

**Por que:** `features/products/components/ProductFormModal.tsx` exige 5 campos obrigatórios mesmo com o lookup perfeito funcionando (categoria/subcategoria, custo, margem, estoque, validade). 200 itens × 90s = **5 horas em pé**. Na prática: cadastra 12, desiste, o resto entra como "MISC" ou não entra.

**O que fazer:**
1. Novo modo **paralelo** dentro de `ProductsPage.tsx`: "Entrada rápida (pallet)". **Não alterar o modal existente** (é a melhor peça de UX do sistema — `ProductFormModal.tsx` tem lookup BigDataCorp, foto, NCM, família, sugestão fiscal, guardião de estoque-zero, deep-link).
2. Fluxo: **bipa** → lookup BDC preenche (como hoje) → só **2 campos obrigatórios na tela** (preço de venda, quantidade) → **"Salvar e próximo (Enter)"** → foco volta ao scanner.
3. O que não foi preenchido: subcategoria oficial inferida pelo NCM quando possível (o `bigdatacorp_service` já tem `NCM_*_FAMILIA`/`PALAVRAS_FAMILIA`); quando não, o item vai com flag `revisar_categoria: true` e aparece na **Lista de Revisão** do dono (que já existe — `cadastro_pendente_revisao` em `models.py:1172`).
4. Estoque-zero consciente **mantém** (é o guardião). Rótulos grandes: "Salvar e próximo (Enter)" / "Abrir completo".
5. Custo: **não** pode ser obrigatório no modo pallet. Decidir o comportamento: o item entra com `origem_custo = "estimado"` e a precificação reversa (`services/precificacao_reversa.py`) calcula venda a partir do preço de mercado — **ou** o item entra sem custo e fica na Lista de Revisão. **Escolher UM e documentar.**

**Valida:**
- Cadastrar 3 itens fictícios por bipagem: com EAN conhecido, sem EAN (código interno 20), com EAN desconhecido → **todos salvos**; o sem-subcategoria aparece em "Revisão".
- **Medir tempo/item ≤ 20s** na prática.

**Critério de parada:** ≤ 20s/item medido. Se não chegar, PARAR e reportar o tempo real — não entregar 40s/item como se fosse 20.

---

## 2.2 Menu por persona do piloto

**Por que:** `components/layout/Sidebar.tsx:34-59` — o menu lista **23 itens** incluindo Força de Vendas, Gestão SFA, Logística & Entregas, RH & Ponto, Controle de Ponto, Fiscal, Auditoria, Monitor Sistema, Leads SaaS, Catálogo Mestre. O filtro é por **cargo**; o dono é nível 1 → vê tudo. O piloto não tem SFA nem delivery → isso vira WhatsApp do CTO.

**O que fazer:**
1. Extrair `getMenuForUser(user)` em `utils/permissions.ts` (o arquivo já tem `getDefaultRoute`, `getSettingsTabs`, `canAccess`).
   - **Dono/gerente de loja de bairro** (nível 1-2, 1 estabelecimento, sem delivery/SFA contratado): Dashboard, PDV, Gerenciar Caixa, Produtos, Clientes, Vendas, Despesas, Relatórios, Entrada de Nota, **"Mais"**.
   - "Mais" = submenu com o resto (visível, mas fora da face).
   - Super admin e modo espelho continuam vendo tudo.
2. `BottomNavigation.tsx` espelha a mesma lista (mobile é o balcão).
3. **Não quebrar** o `ModuleGuard.tsx` / `permissions.ts:137-143` (`getDefaultRoute`): nível 4 → `/pdv`, nível 5 → `/sfa`, nível 6 → `/delivery`, resto → `/dashboard`.

**Valida:**
- Login como o dono do piloto → menu com 10 itens (9 + "Mais").
- Login como super admin → menu completo (23).
- `BottomNavigation` espelha.

---

## 2.3 Onboarding executável (não tour de 13 passos)

**Por que:** `TourExecutivo.tsx` — 13 passos de pitch. **Correção do erro anterior: NÃO dispara sozinho** (só abre pelo botão "Tour & Ajuda"). Mas quem aperta querendo saber "como abrir o caixa" recebe SFA/Delivery/Compras antes do PDV (passo 5) e sai sem saber abrir o caixa.

**O que fazer:**
1. Novo `OnboardingPiloto.tsx` com **4 cards em sequência fixa**:
   - "Abrir meu caixa" → abre o `CaixaManager` com o saldo sugerido de ontem (FASE 1.3)
   - "Cadastrar meu primeiro produto" → abre o scanner no modo Pallet (2.1)
   - "Fazer minha primeira venda" → abre o PDV com 1 item
   - "Fechar meu caixa" → guia no fechamento
2. Cada card: botão que **FAZ** (não explica), estado "feito" persistente **por estabelecimento** (persistir em `localStorage` com chave por `estabelecimento_id` — não em `Configuracao`, que é configuração de operação, não estado de onboarding).
3. O tour antigo continua acessível pelo botão "Tour & Ajuda" — mas deixa de ser a porta de entrada. **A tela inicial continua sendo `/dashboard` para o dono** (mudar isso é decisão de PO do CTO, não do agente).
4. Sem emoji como ícone (regra do projeto: ícone vem do `lucide-react`).

**Valida:** 1 tenant novo em sandbox: login → 4 cards → 4 ações → **TTFV medido** (meta: < 20 min do primeiro login à primeira venda sem ajuda).

---

## 2.4 Dashboard "Hoje" com ação embutida

**Por que:** `features/dashboard/pages/DashboardPage.tsx:23` — `daysFilter = 30` esconde o hoje e o ontem. As 3 perguntas do dono às 7h são: "Fechei bem ontem? / Alguém me deve vencendo hoje? / Falta o quê na gôndola?" — o painel responde em jargão ("Visão Executiva", "Estoque Inteligente"), com período de 30 dias e alertas sem ação.

**O que fazer:**
1. `daysFilter` default → `1` (Hoje).
2. **3 cards de operação acima dos gráficos**, com deep-link já existente:
   - "X produtos com giro > 0 e estoque 0 → [Repor agora]" → `ProductsPage` já recebe `openAdjustFor` (`:288-319`)
   - "Y clientes com fiado vencido → [Cobrar no WhatsApp]" → `wa.me` pronto em `CustomersPage.tsx:173-180`
   - "Caixa aberto há >14h → [Resolver]" → abre o `CaixaManager`
3. Abas em linguagem de loja (não "Visão Executiva").

**Valida:** manual com dados de seed — o dono abre às 7h e vê as 3 perguntas respondidas sem clicar.

---

## 2.5 PIN nos pontos de uso

**Por que:** `SalesPage.tsx:652-654` — o campo de PIN de cancelamento não diz **onde** configura, **quem** tem, nem **o que fazer** quando não sabe. A caixa trava, o cliente espera, o CTO recebe WhatsApp às 21h.

**O que fazer:**
1. Em todo lugar que pede PIN: texto ao lado **"Não sei meu PIN → Configurar"** com deep-link para a aba onde fica. **Localizar a seção real do PIN em `SettingsPage.tsx` antes** (a análise declarou "Sistema & Segurança"; **verificar**, não assumir) e apontar para lá.
2. Mover a seção do PIN para **"Vendas & PDV"** (lugar onde é usada) — `getSettingsTabs` em `permissions.ts:151-160` controla as abas; ajustar a lista se precisar.
3. O `PinDialog.tsx` (`components/modals/PinDialog.tsx`) já existe e valida via `settingsService.verifyPin(pin)` — **reaproveitar**, não criar modal novo.

**Valida:** no cancelamento, clicar no link cai na aba/seção certa.

---

**Saída da Fase 2:** TTFV < 20 minutos medido. Gate: 5 itens verdes + `npx vitest run` verde + `npm run build` ok.

---

# FASE 3 — "O QUE SUMIU" (a promessa que decide o contrato)

> **Verificado em 31/10 11:45: `contagem_ciclica` = 0 hits no backend e 0 no frontend.** A feature **não existe**. É a peça que responde à promessa de venda do piloto ("em 2 meses você sabe exatamente o que está na prateleira e o que está sumindo").

## 3.1 A tela "O que sumiu" (implementar exatamente a spec)

**Fonte da spec (já escrita, escopo fechado):** `docs/SPEC_O_QUE_SUMIU_CONTAGEM_CICLICA_2026-10-31.md`

**Contrato da spec (não inventar fora disso):**
- **2 tabelas:** `contagem_ciclica` (id, estabelecimento_id, nome, status `aberta|conferida|aplicada`, data_abertura, data_aplicacao, funcionario_id) + `contagem_ciclica_itens` (contagem_id, produto_id, quantidade_esperada, quantidade_contada, divergencia, decisao `sumiu|recontar|ajustar|ok`, movimentacao_id).
- **6 endpoints** sob `funcionario_required` + escopo de tenant:
  ```
  GET  /api/contagem/secoes
  POST /api/contagem
  POST /api/contagem/<id>/bipar
  GET  /api/contagem/<id>/conferir
  POST /api/contagem/<id>/aplicar
  GET  /api/contagem/relatorio?de=&ate=
  ```
- **Aplicar** exige nível ≤ 2 (admin/gerente) + PIN válido — **mesma regra do descarte em Produtos** (reaproveitar `PinDialog`).
- **1 página mobile-first** `EstoqueCountsPage.tsx` com 3 telas: lista de seções / bipagem / conferência-decisão.
- **Reusa `MovimentacaoEstoque`** (`models.py:1910-1932`) — motivo `"Contagem cíclica — <seção>"`. **Não criar tabela paralela de perdas.**
- `quantidade_esperada` **congelada** na abertura da contagem.
- Uma seção não pode ter 2 contagens `aberta` ao mesmo tempo (unique parcial).

**Estado atual do repo (verificado):** nada disso existe. `MovimentacaoEstoque` já tem `venda_id`, `pedido_compra_id`, `lote_id`, `funcionario_id`, `motivo`, `quantidade_anterior`, `quantidade_atual`, `custo_unitario`, `valor_total` — **cabe tudo sem migration nessa tabela**.

**O que fazer:**
1. **Blueprint novo** `backend/app/routes/contagem.py` + registro em `backend/app/__init__.py` (padrão: `app.register_blueprint(contagem_bp, url_prefix="/api/contagem")` — ver os 25 blueprints existentes entre as linhas 734-994).
2. **Models** em `backend/app/models.py` (as 2 tabelas da spec) + **1 migration** nova:
   - **Padrão do repo:** ler `backend/migrations/versions/f3b5d7e9a1c3_consumo_api_provedor_60.py` (o HEAD atual) antes de escrever.
   - **HEAD atual: `f3b5d7e9a1c3`** (46 migrations, 1 cabeça). O `down_revision` da nova migration **tem que ser `f3b5d7e9a1c3`** — mas **re-derive o head na hora** (`git fetch origin` + parser estático), porque uma PR paralela pode ter landed uma migration.
   - **O CI tem um teste que falha se houver mais de uma cabeça de migration.** Não quebrar isso.
   - `idempotency_check` com `sa.inspect(op.get_bind()).get_columns(...)` + `batch_alter_table` + `server_default` em toda coluna NOT NULL nova.
3. **Front:** `features/products/pages/EstoqueCountsPage.tsx` + rota em `routes/AppRoutes.tsx` + item no menu (porém: **menu enxuto da 2.2** — "Estoque → Contagem cíclica" fica dentro de Produtos, não como item raiz).
4. **Reusar o scanner-wedge do PDV:** `PDVPage.tsx:211-250` já tem o listener de bip global por velocidade de digitação. **Ler e reaproveitar o padrão** (não copiar o listener inteiro — extraia para um hook se fizer sentido).

**Valida (5 critérios da spec, na ordem):**
1. Dono faz 1 contagem de 30 itens em **< 15 minutos** na primeira vez, sem ajuda.
2. Bipa 1 item que vendeu no meio da contagem → a divergência mostra o "porquê" legível.
3. Aplicar gera 1 `MovimentacaoEstoque` por divergente, motivo "Contagem cíclica", `usuario_id` preenchido (não NULL).
4. Relatório do mês: "Outubro — 12 itens sumidos (R$ 187) — 8 por quebra/validade, 4 sem motivo".
5. Quarta semana: o dono abre sozinho e pergunta qual seção contar **sem o CTO mandar mensagem**.

---

## 3.2 Insight da IA com ação executável

**Por que:** `backend/app/services/consultor/rag.py:15` injeta em **toda** mensagem: *"Não execute ações, não faça cobranças e não trate dados de outra loja como desta loja."* O card diz "Reponha o Café 3 Corações — estoque zerado há 2 dias" e o dono sai do dashboard, vai a Produtos, procura, abre modal, digita, salva — **5 cliques executando o que a IA já diagnosticou**.

**O que já existe (não recriar):**
- Cache de contexto: `services/consultor/contextos/__init__.py` — TTL 300s por (especialista, loja).
- Quota: `services/consultor/quota.py` — 20 insights/dia + 40 chats/dia, com fallback para a última análise cacheada.
- Anti-injeção: `rag.py` trata texto do banco como dado não confiável.
- Deep-links no front: `ProductsPage.tsx:288-319` (`openAdjustFor`/`openDiscardFor`/`openEditFor`), `CustomersPage.tsx:173-180` (wa.me), `ExpiringProductsModal` por state.

**O que fazer:**
1. **Backend** (`routes/consultor.py:gerar_insights`): o prompt passa a pedir JSON `[{tipo, texto, acao: {tipo, payload}}]` com tipos de ação conhecidos: `repor`, `cobrar`, `promocionar`, `ver_contagem`.
   - **A regra anti-injeção e a proibição de executar continuam valendo**: a IA **abre o formulário preenchido**, o humano autoriza. **A IA não executa ação sozinha.** (O texto do system prompt precisa ser atualizado — remover "não execute ações" e manter "não faça cobranças automaticamente / não aplique mudança sem confirmação do operador".)
2. **Front** (`features/consultor/components/InsightCard.tsx`): cada bullet com `acao` renderiza o botão correspondente via os deep-links existentes.
3. Insight **sem** `acao` → renderiza como texto, como hoje (compatibilidade).

**Valida:** 1 insight mock com `acao: {tipo: "repor"}` → o botão abre o ajuste do produto preenchido; insight sem `acao` → texto, sem erro.

---

## 3.3 Alerta de estoque por giro — **LIGAR O QUE JÁ EXISTE**

> ⚠️ **Correção ao plano mestre original.** A versão anterior pedia "criar task + agregação própria". **Não é preciso.** A agregação e a matemática já existem.

**O que já existe (verificado):**
- `backend/app/utils/giro_cache.py:109` — agrega o ledger (`venda_itens`) por produto, **com cache por tenant**.
- `backend/app/models.py:1284-1323` — `Produto.calcular_giro_metrica(quantidade_atual, qtd_janela, dias_ativos, janela_dias=90)` → `{vmd, cobertura_dias, classe}`.
- `backend/app/routes/estoque/tasks.py:42` — o **único** gatilho de alerta hoje: `if produto.quantidade <= produto.estoque_minimo:` (estático, default 10.0).

**O que falta:** **ninguém chama `calcular_giro_metrica` numa task de alerta.** `giro_cache` é usado para **exibir** (cards, lista, modais, Hub).

**O que fazer (mínimo):**
1. **Ligar**, não criar: na task de estoque existente, calcular `cobertura_dias` via `calcular_giro_metrica` usando a agregação do `giro_cache` (já cacheada por tenant — **não** criar agregação nova).
2. Alerta quando `cobertura_dias < 5` (não só quando bate o mínimo) — **no mesmo destino do alerta atual** (o painel de alertas), para não duplicar.
3. **Ajuste contextual simples, só com dados locais:** sexta/sábado (`weekday >= 4`) multiplica a urgência de bebidas (cerveja/refrigerante) por 0.7; dezembro/janeiro multiplica panetone/champanha por 0.5. **Sem API externa.**
4. `calcular_giro_metrica` usa `dias_ativos` (dias desde a 1ª venda, limitado à janela) — **não usar 90 fixo** para item novo, senão item recém-cadastrado parece lento.

**Valida:** produto fictício com alta saída às sextas → a task de quinta gera alerta mais urgente que a de segunda (medir o `cobertura_dias` apresentado).

---

## 3.4 Imposto estimado — **NÃO CALCULAR VALOR, MARCAR COMO "DAS"**

> ⚠️ **Correção ao plano mestre original — a versão anterior estava tecnicamente errada.** Ela propunha zerar ICMS/PIS/COFINS por item no Simples e gravar `venda.imposto_estimado_total`. Isso **quebraria o documento fiscal**.

**Por que a versão anterior estava errada (verificado):**
- `backend/app/services/fiscal/emissao_service.py:155-163` monta o payload da NFC-e lendo `prod.icms_aliquota` / `prod.pis_aliquota` e `prod.cofins_aliquota` (`tributacao.icms_normal()` / `pis_cofins_normal()` calculam `v_bc * aliquota/100`).
- O regime **só** decide o **código** de situação tributária (CSOSN vs CST) e o **CFOP** — `_codigo_icms_payload(prod, estab)` (`:67-71`) e `tributacao.codigos_icms_st(regime)`.
- **Zerar as alíquotas no produto quebraria o ICMS-ST** (que tem regra própria, CFOP 5405 / CST 60) e a base de cálculo do documento.
- `emissao_service.py:7-9` já avisa: *"a correção fiscal final é do contador do lojista"*.
- **NFC-e/NF-e é add-on PAGO, fora do plano do piloto** (Focus NFe é custo do próprio CTO). O piloto **não emite nota**.

**O que fazer (escopo correto e honesto):**
1. **NÃO** criar motor de cálculo de imposto. **NÃO** zerar alíquota. **NÃO** mexer em `tributacao.py`.
2. No DRE / relatório de vendas, quando o estabelecimento for `SIMPLES NACIONAL`:
   - o valor de imposto **não é calculado** — exibe **"—"** com o rótulo **"Simples Nacional — DAS mensal"**;
   - o campo de estimativa fica **vazio**, sem número inventado.
3. Se ainda assim houver campo de imposto na tela, ele passa a ser **informativo por Configure** (o `Configuracao` tem `aliquota_icms`/campos fiscais) e **não** uma conta do sistema. Verificar os nomes reais antes.

**Valida:** relatório com estabelecimento Simples → nenhum valor de imposto calculado; label "DAS mensal" presente.
**Critério de parada:** **se qualquer tela do piloto mostrar "imposto a recolher" como número calculado, PARAR e reportar** — é risco fiscal e contábil.

---

**Saída da Fase 3:** a tela que decide o contrato (3.1), a IA que trabalha (3.2), o alerta por giro (3.3) e o imposto honesto (3.4). Gate: 5 critérios da spec + testes das 3 lacunas + `npm run build` ok.

---

# FASE 4 — PÓS-PILOTO (registrado, NÃO executar agora)

- **Engine de regras DSL** em `configuracoes_json` — verificada ausente (campo existe em `models.py:344`, só `json.loads`/`json.dumps` em `:381-388`, zero interpretação). Escopo próprio, editor no superadmin.
- **Reposição com clima/feriados** (APIs externas) — expande a 3.3 depois de 4-6 semanas de dados reais.
- **Teclado completo no PDV** — setas/Enter no `ProdutoSearch` (verificado: **0 hits** de `onKeyDown`/`ArrowDown`/`tabIndex`/`listbox` em `ProdutoSearch.tsx`; o padrão a copiar está em `components/busca/BuscaGlobal.tsx:123-128`), + atalhos para +/-/remover.
- **Balança** (parser de EAN 2+PLU+peso) — verificada ausente (`routes/pdv.py:576` compara o código literal). **Depende de decisão do CTO: o piloto vende frios/padaria?**
- **Visual** — "Concluir Venda" em emerald (`PDVPage.tsx:1096` é `bg-red-600`), badges ≥12px sem uppercase (`text-[10px] font-black uppercase` em `ProdutoSearch.tsx:149/159/168`), `cor_principal` wireado ou removido (`ConfigContext.tsx:130` aplica a CSS var e **zero** componente consome).

---

# GATES (comandos exatos)

```bash
# Frontend (a partir de frontend/mercadinhosys-frontend)
npx tsc --noEmit -p tsconfig.app.json      # gate barato antes de cada commit
npx vitest run                              # suíte do front (~50s)
npm run build                               # build completo (~2min)

# Backend (a partir de backend)
venv/Scripts/python.exe -m pytest tests/test_no_print_in_app.py -q    # gate de sintaxe (~2s)
venv/Scripts/python.exe -m pytest tests/ -q                            # suíte completa (~8min) — rode em BACKGROUND com notify
```

> ⚠️ **Rodar a suíte completa em background**, nunca em foreground com timeout grande: se o CTO mandar mensagem no meio, o processo morre e o resultado se perde.

> ⚠️ **Baseline de ruído:** ~1.4k warnings por rodada (depreciação `datetime.utcnow`, `LegacyAPIWarning` do `TenantQuery.get`). **Não** tente zerar. O que vale é: **0 falhas**.

> ⚠️ **Lint:** o baseline carrega ~170+ erros de lint PRÉ-EXISTENTES em arquivos não tocados. Depois de editar, filtre o output do lint **só pelos arquivos que você tocou** — contagem global de lint não significa nada.

> ⚠️ **Banco de produção é o PostgreSQL da ORACLE** (docker `oracle-postgres-1`). Aiven é fallback desativado. **Nunca aponte o backend de produção para o SQLite local.**

---

# ORDEM DE EXECUÇÃO

| Ordem | Item | Depende de |
|---|---|---|
| 0 | **1.0** Blindar: commitar docs + `utils/validade.*` + teste, push do `8b2ba9d7`, PR | A outra sessão parar de escrever |
| 1 | **1.3** Fechar a FASE 1.3 em andamento (suíte + tsc + blindar `saldo_final` null) | — |
| 2 | **1.6** Integrar `utils/validade.ts` nos 3 pontos | — |
| 3 | **1.7** Desconto: limite no payload + aviso antes do F9 | — |
| 4 | **1.4** Trocar operador (carrinho por operador) | 1.7 |
| 5 | **1.8** Estorno por item | — |
| 6 | **1.9** Auditoria com `usuario_id` | — |
| 7 | **2.1** Modo Pallet | 1.6 |
| 8 | **2.2** Menu por persona | — |
| 9 | **2.3** Onboarding executável | 1.3, 2.1, 2.2 |
| 10 | **2.4** Dashboard "Hoje" com ação | 2.2 |
| 11 | **2.5** PIN nos pontos de uso | — |
| 12 | **3.1** "O que sumiu" | 1.8, 1.9 |
| 13 | **3.2** Insight com ação | — |
| 14 | **3.3** Alerta por giro | — |
| 15 | **3.4** Imposto honesto (label DAS) | — |

**Go-live do piloto: ao fim da Fase 2 (itens 1-11), com a Fase 1 inteira verificada em produção.**

---

# REGRA FINAL DESTE DOCUMENTO

**Um item por vez. Cada item fecha com: (a) commit pequeno, (b) teste que prova, (c) gate verde, (d) relatório curto ao CTO. Aí PARA e espera o OK.**

**Proibido:** pular item, fazer "só mais um" sem o OK, mexer em arquivo de outra fase sem avisar, `git add .`, deploy sem aprovação do CTO, e criar feature que o `docs/PLANO_MESTRE_IMPLEMENTACAO_2026-10-31.md` já cobre.

---

*Documento gerado por verificação de código em 31/10 11:45-11:55. Nenhuma linha de código de produção foi alterada ao escrevê-lo.*
