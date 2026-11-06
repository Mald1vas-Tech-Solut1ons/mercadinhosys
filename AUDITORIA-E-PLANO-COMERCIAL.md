# MercadinhoSys — Auditoria Técnica & Plano de Distribuição Comercial

> Documento de estado do produto: **o que existe e é robusto**, **o que falta para distribuir profissionalmente**, e um **plano de go-to-market** (incluindo conteúdo para redes) para atender **comércio em geral**.
>
> Data da auditoria: **2026-06-30** · Branch: `master` · Autor: revisão técnica assistida.
> Escopo: backend (Flask/SQLAlchemy, ~25 mil linhas de rotas, 55+ modelos), frontend (React 19 + Vite + Tailwind, PWA), infra (Vercel + VM Oracle com PostgreSQL).

---

## 1. Sumário Executivo

O MercadinhoSys **não é um MVP** — é um ERP de varejo multi-loja já bastante completo, com PDV, estoque, fiscal (NFC-e via gateway), financeiro, RH/ponto, entregas, força de vendas (SFA) e um motor de dashboards analíticos. A base de código é grande e madura, há **isolamento multi-tenant ativo** e **testes automatizados nos pontos críticos** (fiscal, isolamento, vendas, RFM, delivery, PIN de segurança).

**Veredito:** o produto está **tecnicamente pronto para os primeiros clientes pagantes (venda assistida/porta-a-porta)**, mas ainda **não está pronto para distribuição em escala e autoatendimento**. Os bloqueadores para "vender no automático" são poucos e bem definidos: **go-live fiscal real**, **cobrança recorrente automática**, **observabilidade/suporte** e **performance no plano de infra atual**.

| Eixo | Estado | Nota |
|---|---|---|
| Funcionalidade de varejo (PDV, estoque, financeiro) | Robusto | 🟢 |
| Multi-tenant / isolamento de dados | Ativo, com 1 ressalva | 🟡 |
| Fiscal (NFC-e/NF-e) | Backend+front completos, **falta go-live real** | 🟡 |
| Cobrança/assinatura | Link avulso (manual). **Falta recorrência** | 🔴 |
| Observabilidade / suporte / SLA | Incipiente | 🔴 |
| Performance (infra atual) | Sem cold start desde a migração para o Oracle (out/2026) | 🟢 |
| Conteúdo/marketing/posicionamento | A construir | 🔴 |

---

## 2. Inventário — O que existe e funciona (robusto)

Módulos confirmados no código (rotas backend + telas frontend). Nível: 🟢 robusto · 🟡 funciona, precisa de polimento · 🔵 existe, pouco exercitado.

### 2.1 Núcleo de varejo
- **PDV / Frente de caixa** 🟢 — `pdv.py` (1.675 LOC), carrinho, múltiplos pagamentos, peso, código de barras, abertura/sangria/suprimento/fechamento de caixa com relatório impresso. PWA com modo retaguarda.
- **Gestão de Caixa** 🟢 — `caixas.py`, abertura/fechamento, auditoria de movimentações, resumo por forma de pagamento.
- **Produtos & Estoque** 🟢 — `produtos.py` (4.493 LOC, o maior módulo), lotes/validade, custo médio, markup, giro, curva ABC, classificação, histórico de preços, importação, catálogo mestre (Cosmos). 
- **Vendas** 🟢 — `vendas.py`, múltiplos pagamentos, fiado, estorno com PIN de segurança e devolução de estoque.
- **Clientes** 🟢 — `clientes.py` (1.909 LOC), cadastro, RFM, crédito/fiado, tabelas de preço, rotas.
- **Fornecedores** 🟢 — `fornecedores.py`, dossiê, pedido de compra, WhatsApp, importação.
- **Pedidos de compra** 🟢 — `pedidos_compra.py`, criação, recebimento (entra estoque + custo + conta a pagar), boletos a vencer.

### 2.2 Fiscal (diferencial competitivo)
- **Entrada de XML (NF-e de compra)** 🟢 — parser próprio, upsert de fornecedor/produto, entrada de estoque + custo médio, conta a pagar, idempotência por chave.
- **Emissão NFC-e (modelo 65)** 🟡 — `DocumentoFiscal`, gateway trocável (Simulado + **Focus NFe**), emissão/cancelamento, numeração, QR Code, NCM por produto, **trava anti-simulado em produção**. Testado e2e em modo simulado. **Falta:** conta Focus + certificado A1 + CSC da SEFAZ + validação do contador (ação do lojista) → ver §4.2.

### 2.3 Financeiro
- **Despesas** 🟢 — `despesas.py` (1.260 LOC), contas a pagar/receber, boletos, analytics.
- **Contas a pagar/receber** 🟢 — integradas a pedidos de compra e fiscal.

### 2.4 Pessoas
- **Funcionários / RH** 🟢 — `funcionarios.py` (1.455 LOC), `rh.py`, benefícios, banco de horas, holerite, justificativas.
- **Ponto eletrônico** 🟢 — `ponto.py`, registro com foto + geolocalização, estatísticas, histórico, espelho de ponto. *(Fuso horário corrigido em 2026-06-30: usa hora local do dispositivo.)*
- **Papéis & segurança** 🟢 — super admin (SaaS) vs admin da loja; PIN para estorno/edição/descarte.

### 2.5 Operação estendida
- **Entregas / Delivery** 🟡 — `delivery.py`, motoristas, veículos, taxas, rastreamento, custo de entrega.
- **SFA (força de vendas)** 🟡 — `sfa.py`, pedidos de venda externos, aprovação.
- **Relatórios** 🟡 — `relatorios.py` (934 LOC), relatórios agendados.

### 2.6 Plataforma SaaS
- **Multi-tenant** 🟢 — isolamento automático via `TenantQuery` (ativado) + guard HTTP fail-closed. 55+ modelos com `MultiTenantMixin`.
- **Onboarding self-service** 🟢 — signup pela landing → conta ativa com **trial de 30 dias** → avisos in-app (10/5/1 dia).
- **Super admin** 🟢 — ativar/inativar loja, dashboards de SaaS, monitor.
- **Dashboards analíticos** 🟢 — motor "científico", curva ABC, RFM, saúde financeira, DRE, impacto de IA, share por vendedor.
- **Sync offline/híbrido** 🔵 — `sync_hybrid.py`/`sync_cloud.py`; **desligado** (`SYNC_ENABLED=false`) por bug de loop self-referente. PWA funciona online.
- **Billing** 🟡 — `billing_routes.py` + Efí: gera **link de pagamento avulso** (PIX/cartão). **Não há assinatura recorrente** → §4.3.

### 2.7 Qualidade & infra
- **Testes backend** 🟢 — `test_fiscal_nfce`, `test_tenant_isolation`, `test_vendas_multi`, `test_customers_rfm`, `test_delivery_multi`, `test_pin_seguranca`, `test_saas_readiness`, `test_sync_hybrid`, `test_catalogo_lookup`. Travas de regressão nos pontos sensíveis.
- **Testes frontend** 🔴 — apenas 1 smoke Cypress. Cobertura E2E de UI quase inexistente.
- **Infra** 🟢 — Frontend Vercel; backend, PostgreSQL, Redis e Caddy na VM Oracle (Docker). Schema drift já corrigido; sequences de ID ressincronizadas.

---

## 3. Avaliação de robustez (qualidade técnica)

**Pontos fortes**
- Arquitetura multi-tenant real, não improvisada (mixins, query class, guard HTTP fail-closed, testes provando isolamento).
- Domínio de varejo profundo: lotes/validade, custo médio, ABC/RFM, fiado, múltiplos pagamentos, fiscal com NCM e trava anti-simulado.
- Segurança de operação: PIN para ações sensíveis, auditoria (`Auditoria`, `LoginHistory`), soft-delete + audit mixin.
- Disciplina de regressão: cada correção crítica veio com teste.

**Riscos / dívidas técnicas (a tratar antes de escalar)**
1. **Multi-tenant fail-open residual (P0):** o `TenantQuery` é fail-open quando não há tenant em `g`; a invariante depende 100% do guard HTTP `before_request`. Qualquer rota autenticada nova que escape do guard reabre risco de vazamento entre lojas. SQL cru (`text(...)`) e impersonation de super admin não passam pelo filtro automático.
2. **Sync offline desligado:** PWA depende de conexão. Comércio com internet instável (feira, ambulante, interior) sofre. `SYNC_ENABLED=false`.
3. **Performance:** dashboard e listagens pesadas precisam de cache/paginação (o cold start acabou com o Oracle).
4. **Cobertura de teste de UI baixa:** regressões visuais/fluxo (como os modais sob as barras no mobile, já corrigidos) não são pegas por CI.
5. **Schema drift histórico:** produção foi corrigida à mão; migrações precisam ser a fonte única daqui pra frente.

---

## 4. O que FALTA para distribuir profissionalmente

Priorizado por bloqueio comercial. **P0 = bloqueia venda/escala · P1 = importante para profissionalismo · P2 = melhoria.**

### 4.1 [P0] Segurança & conformidade de dados
- Fechar o **fail-open multi-tenant residual** (defesa em profundidade: validar tenant também na camada ORM/sessão, auditar rotas que usam SQL cru).
- **LGPD:** política de privacidade + termos (existe `features/legal`, validar conteúdo), base legal, consentimento, processo de exclusão de dados, contrato de processamento. Necessário para vender com segurança jurídica.
- **Backup/restore documentado** do PostgreSQL de produção + plano de recuperação. Hoje há risco se algo corromper a base única.
- Rotação de segredos, rate-limiting de login, política de senha (parcialmente existe).

### 4.2 [P0] Go-live fiscal real
- Criar conta **Focus NFe** (ou PlugNotas/NFe.io), sair de homologação → produção.
- Processo para o **lojista** subir **certificado A1** e **CSC da SEFAZ**; validação de **CSOSN/NCM pelo contador**.
- Checklist já existe (`CHECKLIST_FISCAL_GO_LIVE.md`). Falta **executar com 1 loja piloto real** e documentar o passo a passo de ativação fiscal no produto.
- Modelo white-label (conta master sua) vs conta do lojista — decidir e documentar comercialmente.

### 4.3 [P0] Cobrança recorrente (monetização no automático)
- Hoje: link de pagamento **avulso** (cobra PIX na mão). Funciona para os primeiros clientes, **não escala**.
- Falta: **assinatura recorrente** (Efí Assinaturas / Pix Automático / cartão tokenizado), webhook que ativa/suspende a loja automaticamente conforme pagamento, e **régua de inadimplência** (suspender no atraso, reativar no pagamento) ligada ao `plano_status`.
- Tela de planos pública + autoatendimento de upgrade/downgrade.

### 4.4 [P1] Observabilidade, suporte e operação
- **Monitoramento de erros** (Sentry/GlitchTip) no front e back.
- **Logs estruturados + alertas** (uptime, 5xx, fila de fiscal).
- **Canal de suporte** (WhatsApp Business / chat / e-mail) + base de conhecimento.
- **Status page** e SLA mínimo declarado.
- **Onboarding guiado** dentro do produto (tour já existe — `WelcomeTour`; expandir com checklist de primeiros passos).

### 4.5 [P1] Performance & infra de produção
- Paginação/caching no dashboard (motor analítico ~9s) e nas listagens pesadas.
- CDN/assets, índices de banco revisados, ressincronizar sequences é processo, não improviso.

### 4.6 [P1] Qualidade & release
- **CI** rodando os testes backend + build do front em cada push.
- **Testes E2E de UI** (Cypress/Playwright) cobrindo: login → venda → fechar caixa → emitir NFC-e; cadastro de produto; trial/expiração.
- **Migrações como fonte única** (nunca mais ALTER manual em produção).
- Versionamento/changelog público.

### 4.7 [P2] Experiência & maturidade de produto
- **Modais mobile** padronizados (já feito em 2026-06-30: portal/z-index/safe-area/dvh).
- **Contraste de cores** em estados selecionados (filtros) — pendente, levantado pelo Rafael.
- Acessibilidade básica (foco, ARIA), i18n se for vender fora.
- Relatórios exportáveis (PDF/Excel) padronizados.

---

## 5. "Atender comércio em geral" — além do mercadinho

O sistema já tem o motor genérico de varejo (produto, estoque, PDV, fiscal, financeiro). Para posicionar como **ERP de comércio em geral**, faltam ajustes de **abrangência e percepção**:

1. **Marca/nome:** "MercadinhoSys" comunica *mercadinho/mercearia*. Para vender a farmácia, pet shop, papelaria, loja de roupas, conveniência, distribuidora, etc., avaliar **nome/temas neutros** ou submarcas por vertical. (Decisão estratégica do Rafael.)
2. **Configuração por segmento (templates):** pré-configurações de categorias, NCM/CFOP típicos, unidades (kg, un, m, L), e campos específicos — ex.: vestuário (grade tamanho/cor), pet/farmácia (lote/validade já existe), serviços (sem estoque).
3. **Variações de produto (grade):** SKU com atributos (tamanho/cor) é essencial para vestuário/calçados — verificar suporte atual; provavelmente é um gap.
4. **NF-e modelo 55** (além de NFC-e): vendas B2B/distribuidora e entregas. Roadmap fiscal já previa.
5. **Balança/etiquetas e impressoras fiscais** populares no varejo brasileiro (suporte a periféricos).
6. **Catálogo de unidades/serviços** para comércios que vendem serviço além de produto.
7. **Multi-loja para a mesma rede** (já é multi-tenant; validar visão consolidada de rede para franquias).

---

## 6. Go-to-market & conteúdo para redes sociais

### 6.1 Posicionamento (a definir e fixar)
- **Promessa central:** "O ERP completo do comércio brasileiro — PDV, estoque, fiscal e financeiro num app só, com nota fiscal de verdade." 
- **Diferenciais reais (provados no código):** emissão fiscal (NFC-e), inteligência (ABC/RFM/saúde financeira), controle de fiado, ponto com foto/GPS, multi-loja, funciona no celular (PWA).
- **Para quem:** comércio de bairro e pequenas redes que hoje usam caderno/planilha ou um PDV "burro" sem gestão.

### 6.2 Pilares de conteúdo (rotação semanal)
1. **Dor → solução** (ex.: "Perdeu mercadoria vencida? Veja o controle de lotes").
2. **Bastidores/educação** (ex.: "O que muda com a NFC-e na sua loja").
3. **Prova/depoimento** (loja piloto usando, números reais anonimizados).
4. **Recurso em 30s** (clipe de tela: fechar caixa, emitir nota, curva ABC).
5. **Gestão para dono de loja** (dicas que ajudam mesmo sem o sistema — gera autoridade).

### 6.3 Formatos & ideias de post (prontos para roteirizar)
- **Reels/Shorts (15-40s):** "Fechei o caixa em 1 toque", "Achei meu produto mais lucrativo (curva ABC)", "Emiti a nota e mandei no WhatsApp do cliente".
- **Carrossel:** "5 sinais de que sua loja precisa sair do caderno"; "Quanto você perde sem controle de validade".
- **Antes/depois:** planilha bagunçada → dashboard limpo.
- **Comparativo honesto:** "PDV comum vs ERP de gestão".
- **Demo guiada (YouTube/landing):** vídeo de 3-5 min do fluxo completo.

### 6.4 Provas e ativos a produzir
- **Conta-demo** já existe (`demo_trial`) → usar para gravar telas reais.
- **1-2 lojas piloto** com depoimento + número ("reduzi X% de perda", "fecho o caixa em Y minutos").
- **Página de planos** clara, FAQ, comparativo, garantia/trial de 30 dias (já implementado) como gancho de conversão.
- **Kit de marca:** logo, paleta, prints padronizados, template de Reels.

### 6.5 Funil sugerido
Conteúdo (Instagram/TikTok/YouTube) → **landing com trial de 30 dias self-service** (já existe) → onboarding guiado no app → **WhatsApp de suporte** → conversão para plano pago (cobrança recorrente — depende do §4.3) → indicação/depoimento.

> **Observação importante:** evitar prometer publicamente "emite nota fiscal" em escala **antes** de concluir o go-live fiscal real (§4.2) com uma loja. O backend está pronto e tem trava anti-simulado, mas a emissão válida exige certificado/CSC do lojista + validação do contador.

---

## 7. Roadmap priorizado (proposta)

### Fase 1 — "Pronto para vender de verdade" (4–6 semanas)
- [ ] Go-live fiscal com **1 loja piloto** (Focus produção + A1 + CSC + contador). **(P0, §4.2)**
- [ ] **Cobrança recorrente** + régua de inadimplência ligada ao `plano_status`. **(P0, §4.3)**
- [ ] Fechar **fail-open multi-tenant residual** + auditar SQL cru. **(P0, §4.1)**
- [x] Infra sem cold start (Oracle). - [ ] Paginar/caching dashboard. **(P1, §4.5)**
- [ ] **Sentry** + uptime + canal de suporte (WhatsApp). **(P1, §4.4)**

### Fase 2 — "Profissional e confiável" (6–10 semanas)
- [ ] **LGPD** completa (política, termos, exclusão de dados, backup documentado). **(P0/P1, §4.1)**
- [ ] **CI** + **E2E de UI** (fluxo de venda/caixa/nota). **(P1, §4.6)**
- [ ] **Onboarding guiado** + base de conhecimento. **(P1, §4.4)**
- [ ] Reativar **sync offline** com correção do loop (resiliência de conexão). **(P1, §3)**
- [ ] **Kit de marca** + conta-demo gravável + 1º vídeo de produto. **(§6)**

### Fase 3 — "Comércio em geral & escala" (paralelo/contínuo)
- [ ] **Variações/grade** de produto (vestuário/calçados). **(§5.3)**
- [ ] **NF-e modelo 55** (B2B/distribuidora). **(§5.4)**
- [ ] **Templates por segmento** + revisão de marca/posicionamento. **(§5.1/5.2)**
- [ ] Suporte a **periféricos** (balança, impressora, etiqueta). **(§5.5)**
- [ ] Motor de conteúdo rodando (calendário editorial, §6.2).

---

## 8. Dependências que exigem ação do Rafael (não são código)
1. Abrir conta no **gateway fiscal** e definir white-label vs conta do lojista.
2. Conseguir **1–2 lojas piloto** dispostas a validar fiscal e dar depoimento.
3. Contratar/definir o **provedor de pagamento recorrente** (Efí Assinaturas/Pix Automático).
4. Decisão de **marca/posicionamento** ("comércio em geral").
5. Definir **preço dos planos** e política de trial/garantia.
6. Validação **contábil** (CSOSN/NCM/CFOP) com contador parceiro.

---

### Anexos / fontes no repositório
- `PROGRESS_CTO.md` — tracking detalhado do roadmap fiscal/CTO.
- `CHECKLIST_FISCAL_GO_LIVE.md` — passo a passo de ativação fiscal.
- `backend/tests/` — travas de regressão (fiscal, isolamento, vendas, RFM, delivery, PIN, SaaS readiness).
- `backend/app/models.py` — 55+ modelos de domínio.
- `backend/app/routes/` — ~25 mil linhas, 33 módulos de API.
