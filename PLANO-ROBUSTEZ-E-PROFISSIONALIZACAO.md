# MercadinhoSys — Plano de Robustez & Profissionalização

> Plano de execução para tornar o sistema **impecável, robusto e profissional**, alinhado ao [Plano Comercial](AUDITORIA-E-PLANO-COMERCIAL.md).
>
> Filosofia: **quase tudo que deixa o sistema robusto é GRÁTIS** (código, GitHub Actions, Sentry free, backups do PostgreSQL). Dinheiro só destrava **infra sem cold start**, **pagamento recorrente** e **fiscal real**. Então dá para deixar o produto "impecável por dentro" **agora, com R$0**, e a virada para infra paga vira só o **último botão**.
>
> Data: 2026-06-30.

---

## 0. Definição de "Impecável" (checklist de prontidão de produção)

O sistema é considerado **production-grade** quando TODOS estes itens estiverem verdes. Use como termômetro:

**Segurança & dados**
- [ ] Isolamento multi-tenant com defesa em profundidade (não só guard HTTP).
- [ ] Nenhuma rota autenticada escapa do contexto de tenant (auditado).
- [ ] Backup automático + restore testado (com data de último teste).
- [ ] LGPD: política, termos, exclusão de dados, base legal.
- [ ] Segredos fora do código, rate-limit no login, política de senha.

**Confiabilidade & operação**
- [ ] Monitoramento de erros (front + back) com alerta.
- [ ] Uptime/health monitor + status declarado.
- [ ] Logs estruturados; consigo investigar um erro de cliente em < 5 min.
- [ ] Runbook de deploy, backup/restore e incidente escrito.
- [ ] Sem cold start; p95 de telas-chave < 2s.

**Qualidade & release**
- [ ] CI roda testes backend + build front em todo push (bloqueia merge quebrado).
- [ ] E2E de UI cobrindo o fluxo crítico (login→venda→caixa→nota).
- [ ] Migrações são a fonte única do schema (zero ALTER manual).
- [ ] Changelog/versionamento.

**Negócio**
- [ ] Cobrança recorrente automática + régua de inadimplência.
- [ ] Go-live fiscal validado com 1 loja real.
- [ ] Onboarding guiado + canal de suporte.

> Hoje: dá pra fechar **a maioria de Segurança/Qualidade/Operação com R$0**. Os itens de "sem cold start", "cobrança" e "fiscal" são os que pedem dinheiro/ação externa.

---

## 1. Mapa de custos (o que é grátis x o que custa)

| Item | Custo | Destrava |
|---|---|---|
| Hardening de segurança/isolamento | **R$0** (código) | Confiança para vender |
| CI (GitHub Actions) | **R$0** (free tier generoso) | Qualidade de release |
| Sentry / GlitchTip (erros) | **R$0** (free tier) | Suporte e confiabilidade |
| Backups do PostgreSQL (Oracle, validados pelo `release.py` antes de cada deploy) | **R$0** | Sobrevivência a desastre |
| Otimização de performance (cache/índices/paginação) | **R$0** (código) | Velocidade percebida |
| LGPD (docs + endpoint de exclusão) | **R$0** (texto + código) | Segurança jurídica |
| Reativar sync offline | **R$0** (código) | Resiliência de conexão |
| Infra sem cold start | **R$0** — feito: produção na VM Oracle (backend + PostgreSQL + Redis + Caddy) | Acaba o "sistema travado" |
| Gateway fiscal (Focus NFe) | por nota + A1 ~R$120-250/ano (do lojista) | Nota fiscal real |
| Pagamento recorrente (Efí) | % por transação | Monetização automática |

**Leitura financeira:** o cold start (maior dor de percepção) **morre com US$7**, não precisa dos US$25 para isso. Os US$25 são para quando várias lojas usarem o dashboard pesado ao mesmo tempo. Planeje **US$7 primeiro**, US$25 quando o motor analítico sob carga pedir.

---

## 2. Ondas de execução

Ordenado para maximizar robustez com R$0 antes de qualquer gasto.

### 🌊 Onda 0 — "Blindar por dentro" (R$0, fazer AGORA)

Tudo aqui é código/configuração grátis. É o que deixa o sistema **profissional independentemente da infra**.

#### 0.1 [P0] Defesa em profundidade no multi-tenant
- **O quê:** garantir que nenhuma query autenticada rode sem tenant, mesmo se uma rota nova escapar do guard.
- **Como:**
  - Auditar todas as rotas autenticadas que usam `db.session.execute(text(...))` / SQL cru e adicionar filtro de `estabelecimento_id` explícito.
  - Adicionar um teste que percorre os blueprints e falha se uma rota autenticada não estiver coberta pelo guard (lista de exceções explícita).
  - Revisar impersonation de super admin (hoje faz bypass total) → filtrar pelo tenant impersonado.
- **DoD:** teste de isolamento cobre SQL cru e impersonation; PR não passa se alguém adicionar rota fora do padrão.

#### 0.2 [P0] CI no GitHub Actions
- **O quê:** rodar `pytest` (backend) + `tsc -b && vite build` (frontend) em todo push/PR.
- **Como:** workflow `.github/workflows/ci.yml`; subir Postgres de serviço para os testes; cache de deps.
- **DoD:** badge verde no README; merge bloqueado se teste/build falhar.

#### 0.3 [P0] Monitoramento de erros (grátis)
- **O quê:** Sentry (free tier) no backend Flask e no frontend React.
- **Como:** SDK + DSN via env; capturar exceções não tratadas; release tagging.
- **DoD:** um erro forçado aparece no painel com stack + tenant + usuário (sem PII sensível).

#### 0.4 [P0] Backups & restore testado
- **O quê:** confirmar/configurar backup automático do PostgreSQL no Oracle e **testar um restore** em base descartável.
- **Como:** documentar retenção; script de restore; registrar data do último teste.
- **DoD:** "consigo restaurar o banco em X minutos" comprovado e datado no runbook.

#### 0.5 [P1] Performance sem trocar de infra
- **O quê:** atacar o dashboard ~9s e listagens pesadas **com código** (não depende de infra paga).
- **Como:**
  - Cache do resultado do motor analítico por tenant + janela (TTL curto; invalidar em venda).
  - Paginação real nas listagens grandes; `selectinload` onde houver N+1 (produtos já feito).
  - Revisar índices (FKs, `estabelecimento_id`, `data_venda`, `status`).
- **DoD:** dashboard p95 < 3s **na VM de 1 GB do Oracle**; listagens < 1,5s.

#### 0.6 [P1] Migrações como fonte única
- **O quê:** acabar com ALTER manual; schema = Alembic.
- **Como:** gerar migração que reconcilie o que foi feito à mão no banco; `flask db upgrade` no deploy; proibir alteração manual no runbook.
- **DoD:** `flask db upgrade` em base limpa reproduz produção 100%.

#### 0.7 [P1] E2E de UI (fluxo crítico)
- **O quê:** Cypress/Playwright cobrindo login → adicionar produto → venda → fechar caixa → emitir NFC-e (simulado) → trial expira/bloqueia.
- **DoD:** roda no CI; quebra se um fluxo crítico regredir (ex.: modal sob a barra, botão sem função).

#### 0.8 [P1] LGPD mínima viável
- **O quê:** política de privacidade + termos (revisar `features/legal`), endpoint de **exclusão/exportação de dados** do titular, base legal documentada.
- **DoD:** loja consegue pedir exclusão e o sistema executa; textos publicados.

#### 0.9 [P2] Reativar sync offline
- **O quê:** corrigir o loop self-referente (`SYNC_ENABLED=false`) e religar com salvaguarda anti-loop.
- **DoD:** venda offline sincroniza ao reconectar sem duplicar; teste cobre.

#### 0.10 [P2] Acabamento de UX levantado
- **O quê:** contraste de cores em estados selecionados (filtros) — pendente; padronizar exportações (PDF/Excel).
- **DoD:** sem texto/ícone claro em fundo claro (e vice-versa) nos temas claro/escuro.

---

### 🌊 Onda 1 — "Virar a chave da infra" (US$7 → US$25)

Quando houver caixa. **Pouco código, muito impacto de percepção.**

#### 1.1 Infra sem cold start — FEITO (out/2026)
- Produção migrou para a VM Oracle (Docker: backend, PostgreSQL, Redis, Caddy). Health sempre 200; sem
  hibernação. Próximo gatilho de upgrade: memória da VM (1 GB) sob várias lojas no dashboard.

#### 1.3 Pós-upgrade: validar o pacote inteiro
- Rodar o checklist da §0 em produção paga; medir p95; confirmar Sentry/uptime/backup ativos.

---

### 🌊 Onda 2 — "Monetizar e emitir nota de verdade" (custos variáveis + ação externa)

#### 2.1 Cobrança recorrente + régua de inadimplência
- **O quê:** assinatura automática (Efí Assinaturas/Pix Automático/cartão tokenizado); webhook ativa/suspende loja conforme pagamento, ligado a `plano_status`.
- **DoD:** loja que não paga é suspensa automaticamente e reativada ao pagar; tela de planos self-service.

#### 2.2 Go-live fiscal com loja piloto
- **O quê:** conta Focus em produção; lojista sobe A1 + CSC; contador valida CSOSN/NCM/CFOP; emitir nota real.
- **DoD:** 1 loja emitindo NFC-e válida em produção, documentada no `CHECKLIST_FISCAL_GO_LIVE.md`.

---

## 3. Plano de qualidade contínua (o que mantém "impecável" depois)

- **CI obrigatório** em todo PR (testes + build + lint).
- **Cobertura mínima** nos módulos de dinheiro (vendas, caixa, fiscal, billing) — meta progressiva.
- **Cada bug crítico vira teste** (já é a cultura; manter).
- **Code review** antes de merge na `master`.
- **Changelog** por release.

---

## 4. Runbook de produção (a escrever na Onda 0)

Documento operacional curto cobrindo:
1. **Deploy:** `infra/oracle/release.py` (stage com ensaio em clone do banco → deploy com backup e rollback automático); frontend pela CLI da Vercel.
2. **Backup/restore:** onde, retenção, como restaurar, último teste.
3. **Incidente:** onde olhar (Sentry/logs/uptime), como reverter deploy, como entrar na VM Oracle.
4. **Fiscal:** como ativar uma loja (A1/CSC), como reprocessar nota travada.
5. **Acessos/segredos:** inventário e rotação.

---

## 5. Cronograma sugerido (realista, sem pressa de dinheiro)

| Período | Foco | Custo |
|---|---|---|
| Semanas 1–2 | Onda 0.1–0.4 (isolamento, CI, Sentry, backup) | R$0 |
| Semanas 3–4 | Onda 0.5–0.7 (performance, migrações, E2E) | R$0 |
| Semanas 5–6 | Onda 0.8–0.10 (LGPD, sync, UX) + runbook | R$0 |
| Feito (out/2026) | Onda 1 — produção no Oracle, sem cold start | R$0 |
| Com piloto | Onda 2 (cobrança + fiscal real) | variável |

**Resultado:** ao terminar a Onda 0 (tudo grátis), o sistema já está **profissional e robusto por dentro** — a infra sem cold start já está no ar (Oracle).

---

## 6. O que depende de você (não-código)
2. Criar conta no **gateway fiscal** + conseguir **loja piloto**.
3. Escolher **provedor de pagamento recorrente** e definir **preços dos planos**.
4. Validação **contábil** (CSOSN/NCM/CFOP).
5. Revisar textos **LGPD** (idealmente com apoio jurídico).

> Próximo passo prático sugerido: começar pela **Onda 0.1 (multi-tenant) + 0.2 (CI) + 0.3 (Sentry)** — são as três que mais elevam o "nível profissional" e custam R$0. Posso abrir cada uma como tarefa e já implementar a 0.2 (CI) e a 0.3 (Sentry), que são rápidas.
