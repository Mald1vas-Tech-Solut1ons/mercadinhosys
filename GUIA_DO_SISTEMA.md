# Guia do Sistema — MercadinhoSys

> Documento-âncora: o que está **de fato construído, ligado e testado** no
> sistema, e como cada peça funciona. Mantido enxuto e verdadeiro — se algo não
> está aqui, trate como "não garantido". Última atualização: 2026-06-26.

---

## 1. O que é

ERP + PDV multi-tenant (SaaS) para mercados/lojas de varejo e atacado.
Backend Flask + SQLAlchemy (Postgres em produção, SQLite em dev). Frontend
React 18 + TypeScript + Vite, PWA instalável. Backend publicado na VM Oracle (`infra/oracle/release.py`); frontend na Vercel.

**Papéis (importante):**
- **Super admin = dono do SaaS (Rafael)** — `is_super_admin`, nível 0, vê todas as lojas. Não opera caixa.
- **Admin = dono da loja (tenant)** — nível **1**. Gerencia a operação da loja.
- 2 Gerente · 3 Caixa · 4 Estoque · 5 RH · 6 Entregador.

---

## 2. Como rodar

**Docker (recomendado):**
```bash
cp .env.example .env   # preencha os segredos
make install           # sobe backend + frontend + db
```
**Manual:** backend `cd backend && python -m venv venv && pip install -r requirements.txt && python run.py`;
frontend `cd frontend/mercadinhosys-frontend && npm install && npm run dev`.

**Testes backend:** `cd backend && venv/Scripts/python -m pytest tests/ -q`
(estado atual: **41 passed, 1 xfailed**).
**Build frontend (gate de produção):** `cd frontend/mercadinhosys-frontend && npm run build`.

**Deploy:** trabalha-se em `main`; para subir, `master` recebe fast-forward de
`main` e `git push origin master` dispara o deploy.

---

## 3. Sistemas sólidos (construídos e testados)

### 3.1 Isolamento multi-tenant (segurança) ✅
- Cada loja só enxerga os próprios dados. Garantido por `TenantQuery`
  (`backend/app/models.py`), ativado via `SQLAlchemy(query_class=TenantQuery)`.
- Filtra automaticamente por `g.estabelecimento_id` em `Model.query` E
  `db.session.query` (get/all/first/one/count/scalar/iter/paginate).
- **Fail-closed:** token de tenant autenticado sem estabelecimento resolvido
  recebe 403 (`before_request` em `app/__init__.py`). Não vaza dados de outras lojas.
- Bypass proposital para super-admin e impersonation.
- Testes: `backend/tests/test_tenant_isolation.py`.
- Resíduo conhecido: SQL cru (`text(...)`) e impersonation dependem de filtro manual.

### 3.2 Fiscal — NFC-e (modelo 65) ✅ (terreno pronto)
- Emissão, listagem, cancelamento e importação de XML de entrada implementados.
- Adapter **Focus NFe** real + adapter **Simulado** (sem valor fiscal, p/ dev).
- Numeração por loja, idempotência por venda, payload CSOSN/Simples Nacional.
- **Travas de produção:** recusa emitir se (a) gateway real não configurado ou
  (b) produto sem **NCM válido** (8 dígitos) — não inventa NCM.
- Cadeia do NCM completa: escanear código → Cosmos → salvo no produto → lido na nota.
- Telas: PDV/Vendas (botão Emitir NFC-e), Fiscal (entrada + notas emitidas),
  Configurações → Fiscal (credenciais).
- Testes: `backend/tests/test_fiscal_nfce.py`.
- **Para go-live real:** ver `CHECKLIST_FISCAL_GO_LIVE.md` (credenciais do lojista:
  certificado A1 + CSC + token Focus). Software pronto; falta plugar credenciais.

### 3.3 Catálogo de produtos por código de barras (Cosmos) ✅
- Escanear EAN preenche nome, marca, NCM e imagem automaticamente.
- `GET /produtos/catalogo/lookup/<ean>`: tenta o **catálogo local primeiro**
  (sem quota) e, no miss, consulta o Cosmos **gravando no catálogo** (cresce
  sozinho). Cache negativo para EAN inexistente. Erros transparentes (quota/
  token/conexão/não-encontrado).
- Token via `COSMOS_TOKEN` (env) com fallback embutido. Plano free é suficiente
  pois cada EAN só consome quota uma vez.
- Testes: `backend/tests/test_catalogo_lookup.py`.

### 3.4 PIN de segurança ✅
- Autoriza operações sensíveis: estorno de venda + **editar/desativar/descartar
  produto**. PIN de 4-6 dígitos (hash), o **mesmo** registro do admin.
- Define-se em **Configurações → Sistema & Segurança** (só admin nível 1 da loja).
- Backend: `verificar-pin` (gate) e `GET/PUT /configuracao/pin`. Valida contra
  admins/gerentes (nível ≤ 2) do tenant.
- Frontend: `PinDialog` reutilizável.
- Testes: `backend/tests/test_pin_seguranca.py`.

### 3.5 BI / Relatórios ✅
- ReportsPage: Vendas, DRE, RFM, Curva ABC, Previsão de esgotamento,
  Fornecedores, Clientes. Exporta PDF/Excel/CSV.

### 3.6 PDV, Caixa, Multi-pagamento, Delivery/SFA, Ponto/RH ✅
- PDV com atalhos, múltiplos pagamentos, sangria/suprimento; caixa com auditoria
  (gaveta física vs digital); fiado; ponto fotográfico.

### 3.7 SaaS: trial, onboarding, super admin ✅
- Onboarding self-service com trial; super admin ativa/inativa lojas.

### 3.8 PWA ✅ (pull-to-refresh ⚠️ não testado em device)
- Instalável (standalone). Como standalone não tem refresh nativo, há um
  pull-to-refresh próprio (`usePullToRefresh` no `MainLayout`). **Validar no celular.**

---

## 4. Frentes P0 ainda abertas (para vender com responsabilidade)

1. **Billing real (cobrança SaaS):** checkout usa CNPJ mock e cancelamento
   simulado. Falta plugar gateway (Asaas/Stripe/Efí) + webhook → ativação
   automática do tenant. É o que destrava a venda self-service.
2. **Fiscal em produção real:** validar 1 nota em homologação Focus NFe com
   certificado/CSC reais (ação do dono + contador). Software já pronto.
3. **Confirmação automática de PIX** (webhook) em vez de operador clicar "Pago".

---

## 5. Credenciais de teste (DEV)

- Admin de loja: `admin1` / `admin123`
- Acesso demo: botão "Acesso Demo" gera ambiente automático.

---

## 6. Onde está cada coisa

- Backend rotas: `backend/app/routes/` (pdv, vendas, produtos, fiscal, caixas,
  configuracao, relatorios, saas, delivery, sfa, ponto, rh...).
- Serviços fiscais: `backend/app/services/fiscal/`.
- Modelos: `backend/app/models.py`. Seed de simulação: `backend/app/simulation/`.
- Frontend features: `frontend/mercadinhosys-frontend/src/features/`.
- Docs vivos: este guia, `README.md`, `CHECKLIST_FISCAL_GO_LIVE.md`,
  `README_DOCKER.md`, `README-LOCAL.md`.
