<div align="center">

# 🛒 MercadinhoSys (v5.0 Enterprise)

### Plataforma SaaS Multi-Tenant de Gestão Comercial e E-commerce

*O sistema operacional de ponta a ponta para o varejo moderno. ERP, PDV Fiscal, Gestão de Recebimentos e Business Intelligence em uma única plataforma na Nuvem.*

<br/>

[![Version](https://img.shields.io/badge/version-5.0.0-2563eb?style=for-the-badge)](#)
[![Status](https://img.shields.io/badge/status-Enterprise_Ready-16a34a?style=for-the-badge)](#)
[![PWA](https://img.shields.io/badge/Duo_Management-Mobile_&_Desktop-9333ea?style=for-the-badge&logo=pwa&logoColor=white)](#)
[![License](https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge)](#-licença--autor)

<br/>

**Frontend (Client & Mobile)**

![React](https://img.shields.io/badge/React_18-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)
![PWA](https://img.shields.io/badge/Progressive_Web_App-5A0FC8?style=flat-square&logo=pwa&logoColor=white)

**Backend (Core Services)**

![Python](https://img.shields.io/badge/Python_3.11+-3776AB?style=flat-square&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask_RESTful-000000?style=flat-square&logo=flask&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy_2.0-D71F00?style=flat-square&logo=sqlalchemy&logoColor=white)
![JWT](https://img.shields.io/badge/JWT_Auth-000000?style=flat-square&logo=jsonwebtokens&white)

**Data & Cloud Infrastructure**

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Oracle](https://img.shields.io/badge/Oracle_OCI-F80000?style=flat-square&logo=oracle&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)

</div>

## Hospedagem atual

Frontend na Vercel; API e PostgreSQL na Oracle OCI. Consulte
[instalação, seed, acessos e backup](infra/oracle/DEMO.md) e
[Consultor M-IA com RAG](infra/oracle/IA-RAG.md).

---

## ✨ Visão Geral da Arquitetura

O **MercadinhoSys** evoluiu de um sistema de caixa para um **Ecossistema Enterprise Multi-Tenant**. Projetado para suportar operações comerciais intensas com resiliência militar. 

Nossa arquitetura prioriza **Zero-Downtime** e tolerância a falhas. O backend foi desenvolvido utilizando **Savepoints Transacionais (`begin_nested`)** que isolam falhas pontuais (ex: desatualização temporária de Schema) garantindo que rotas críticas, como o fechamento de vendas no PDV, nunca abortem a transação principal do banco de dados de produção.

> 📱 **Mobile-First & Duo Management**: O sistema é 100% projetado para ser gerenciado tanto na mesa do escritório (Desktop) quanto na palma da mão (Mobile via PWA), trazendo ferramentas como Seletor de Tenant, Painel SaaS e Auditoria diretamente no celular do dono do negócio.

---

## 🎯 Capacidades Enterprise

### 🧾 Integração Fiscal e Inteligência Tributária
- **Motor NFC-e / NF-e**: Emissão nativa integrada à SEFAZ (via Focus NFe) com tratativa automática de rejeições, cancelamentos e impressão de DANFE com QR Code oficial.
- **Auditoria de NCM/CEST e CFOP**: Bloqueio ativo de emissão para produtos com tributação ausente ou irregular, garantindo conformidade fiscal para os lojistas.

### 📦 Gestão Profissional de Produtos (Master Catalog & Sefaz/Cosmos)
- **Harvester Inteligente (API Cosmos)**: Leitura de código de barras consome dados diretamente da base da Cosmos/Bluesoft.
- **Cache Negativo com TTL Dinâmico**: Produtos não encontrados ganham cache local de 7 dias (para preservar a quota da API), com opção de *Force Sync* via UI (Devolve o poder ao estoquista).
- **Entrada via XML (O Padrão Ouro)**: Importação de Notas Fiscais de Entrada extrai EAN, NCM, CEST, Lotes e custos diretamente do XML dos fornecedores, auto-alimentando o catálogo e o estoque.

### 🏢 Plataforma SaaS (Multi-Tenancy Isolado)
- **Proteção Fail-Closed no ORM**: Todo e qualquer query é blindada pelo `TenantQuery`. Um lojista **nunca** consegue acessar o ID de outro, mesmo por Injection.
- **Gestão de Franquias (SuperAdmin)**: O "Duo Gerenciamento" permite ao dono do sistema transitar (impersonar) contas de Lojistas pelo smartphone com 1 clique para auditar ou ajudar no suporte.

### 📊 Business Intelligence Científico
- **Dashboard Executivo**: Curva ABC, RFM de Clientes (Machine Learning base) e previsão algorítmica de ruptura de estoque.
- **Gestão de DRE**: Fechamento automático com cruzamento de Despesas vs. Faturamento líquido.

---

## 🚀 Engenharia e Resiliência em Produção

O MercadinhoSys v5.0 conta com um pipeline avançado de implantação:

1. **Testes e Build Automatizados**: O GitHub Actions audita dependências, compila o Frontend (TypeScript Strict) e roda testes no Backend (Pytest).
2. **Deploy Automático**: Vercel (Front) e Render (Back).
3. **Database Migrations Seguras**: Flask-Migrate sincroniza perfeitamente o schema no PostgreSQL de produção. Em caso de *schema drift*, as consultas no Python isolam exceções via `psycopg2` Savepoints, impedindo queda em cascata (*Efeito Dominó*).

### Setup Rápido (Ambiente de Desenvolvimento)
```bash
git clone https://github.com/MaldivaSky/mercadinhosys.git
cd mercadinhosys
cp .env.example .env
make install
```

<div align="center">

| Serviço | URL | Acesso |
|---|---|---|
| 🖥️ Frontend | `http://localhost` | botão **Acesso Demo** |
| ⚙️ Backend API | `http://localhost:5000` | JWT |

</div>

> Setup manual (sem Docker): veja [`README-LOCAL.md`](README-LOCAL.md) · Guia Docker completo: [`README_DOCKER.md`](README_DOCKER.md)

---

## 🧩 Funcionalidades

### 📊 Business Intelligence & Analytics
- **Dashboards executivos** em tempo real: faturamento, margens, lucro líquido, ticket médio.
- **Curva ABC** automática (Pareto) e gestão científica de estoque/validade.
- **Análise RFM** de clientes: segmentação automática (Campeões, Fiéis, Em Risco, Perdidos).
- **DRE** e relatórios exportáveis em **PDF / Excel / CSV**.

### 🧾 Fiscal (NFC-e) & Catálogo Inteligente
- **Emissão de NFC-e** (modelo 65) via gateway **Focus NFe**, importação de **XML de entrada**, cancelamento e numeração por loja.
- **Travas de produção responsáveis:** não emite sem gateway real configurado nem com produto **sem NCM válido**.
- **Cadastro por código de barras:** leitura de EAN preenche nome, marca, **NCM** e imagem via catálogo local + **API Cosmos**, com cache que cresce sozinho (economiza quota).

### 🏢 Multi-Tenant & SaaS
- **Isolamento de dados por loja** garantido em nível de ORM (`TenantQuery`) com política **fail-closed** — um lojista jamais vê o dado de outro.
- **Onboarding self-service** com trial; super admin (dono do SaaS) ativa/inativa lojas.
- **Planos & permissões** por nível de acesso (Admin → Entregador).

### 🖥️ PDV & Operação de Loja
- Frente de caixa ultrarrápida com **atalhos de teclado** e **múltiplos pagamentos**.
- **Caixa blindado:** auditoria de quebra separando gaveta física (dinheiro) de fluxo digital (Pix/cartão).
- **Crédito (fiado)**, sangria/suprimento, **SFA** e **Delivery** com rotas e comissões.
- **PIN de segurança** para operações sensíveis (estorno, editar/descartar produto).

### 👥 RH & PWA
- **Ponto fotográfico** com geolocalização; holerites, escalas e banco de horas.
- **PWA instalável** (mobile/desktop) com cache offline e pull-to-refresh próprio.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│   Frontend (PWA)            │  HTTPS │   Backend API (Flask)         │
│   React 18 · TS · Vite      │◄──────►│   REST · JWT · SQLAlchemy     │
│   Tailwind · Recharts       │  JSON  │   TenantQuery (multi-tenant)  │
└─────────────────────────────┘        └───────────────┬──────────────┘
                                                        │
                                  ┌─────────────────────┼─────────────────────┐
                                  │                      │                     │
                            PostgreSQL / SQLite     Focus NFe (fiscal)    API Cosmos (EAN)
```

- **Multi-tenant real:** toda consulta é escopada por estabelecimento automaticamente; rotas autenticadas sem tenant resolvido recebem `403` (fail-closed).
- **Detecção de ambiente:** SQLite em dev, PostgreSQL em produção, sem mudança de código.

---

## 📚 Documentação

| Documento | Conteúdo |
|---|---|
| [`GUIA_DO_SISTEMA.md`](GUIA_DO_SISTEMA.md) | **Âncora** — o que está construído, ligado e testado |
| [`CHECKLIST_FISCAL_GO_LIVE.md`](CHECKLIST_FISCAL_GO_LIVE.md) | Passo a passo para ativar a emissão fiscal de uma loja |
| [`README_DOCKER.md`](README_DOCKER.md) | Guia completo de Docker |
| [`README-LOCAL.md`](README-LOCAL.md) | Setup manual local |

---

## 🔐 Segurança

- ✅ **Autenticação JWT** com refresh tokens.
- ✅ **Isolamento multi-tenant ativo** (`TenantQuery` + `before_request` fail-closed).
- ✅ **PIN de segurança** (hash) para estorno, edição e descarte de produtos.
- ✅ **Rate limiting** e proteção contra brute-force nas rotas sensíveis.
- ✅ **Auditoria transacional** de caixa, vendas e acessos.
- ✅ Segredos fora do versionamento (env vars no servidor).

---

## 🧪 Qualidade

```bash
# Backend (pytest)
cd backend && venv/Scripts/python -m pytest tests/ -q     # 41 passed, 1 xfailed

# Frontend (type-check + build de produção)
cd frontend/mercadinhosys-frontend && npm run build
```

Cobertura de testes nos pontos críticos: isolamento multi-tenant, emissão fiscal (NFC-e), lookup de catálogo (Cosmos) e PIN de segurança.

---

## ☁️ Deploy

Trabalha-se em `main`; a branch **`master`** recebe o *fast-forward* de `main` e o `git push origin master` dispara o deploy (**Render** para o backend, **Vercel** para o frontend, **PostgreSQL** gerenciado).

> Variáveis sensíveis (`SECRET_KEY`, `JWT_SECRET_KEY`, `COSMOS_TOKEN`, credenciais fiscais) ficam nas *env vars* do servidor — nunca no git.

---

## 🗺️ Roadmap de Inovação

O ecossistema não para de crescer. Próximos módulos:

- [ ] **Billing SaaS** — gateway de pagamento real (Asaas/Stripe/Efí) + webhook → ativação automática do tenant.
- [ ] **Marketplace E-commerce (White Label)**: Cada Tenant gerará seu próprio Link/Loja Digital com carrinho sincronizado ao estoque do ERP em tempo real (Next.js & Django).
- [ ] **Fiscal em produção** — homologação real Focus NFe (certificado A1 + CSC do lojista).
- [ ] **PIX automático & Conciliação Bancária** — integração OFX e baixas financeiras diretas via webhook bancário.
- [ ] **Impressoras fiscais** (WebUSB/Bluetooth) e **previsão de ruptura** com ML.

---

## 🤝 Contribuindo

1. Fork o projeto
2. Crie sua branch (`git checkout -b feature/MinhaFeature`)
3. Commit (`git commit -m 'feat: minha feature'`)
4. Push (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

---

## 📝 Licença & Autor

Distribuído sob a licença **MIT**.

<div align="center">

<img src="docs/maldivas-tech.jpg" alt="MaldivasTech Logo" width="200" style="border-radius: 12px; margin-bottom: 16px;" />

Desenvolvido com 💙 por **MaldivasTech** — feito com alma amazônica 🌳

**MercadinhoSys** · ERP Multi-Tenant · Production Ready

</div>
