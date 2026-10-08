# Release modular MercadinhoSys — 07/10/2026

Conclusão operacional registrada em **2026-10-07T22:09:03-03:00** (São Paulo).
Este relatório substitui o status parcial de `REVISAO_DEVOPS_COMMITS_2026-10-07.md`; aquele documento preserva a auditoria histórica.

## Publicação e rastreabilidade

- Repositório: https://github.com/Mald1vas-Tech-Solut1ons/mercadinhosys; PR https://github.com/Mald1vas-Tech-Solut1ons/mercadinhosys/pull/3, integrado em `master` pelo merge `5c0b4ae9048a22e12dcb5698a63cd870177d5e99`.
- Backend publicado: revisão OCI `6d95713cf189f798aa98eb7f1fd64fa584a30683`, imagem `sha256:0de6a25b4082cdc70dd58194d93922fa419dc56fe65373c3a459e0c06dfa582d`.
- Frontend produção: `dpl_Em78qKzfF69TaVCn9Fp1agMG63gh`, revisão `6d95713cf189f798aa98eb7f1fd64fa584a30683`; https://mercadinhosys.vercel.app.
- API: https://mercadinhosys-api.144.22.151.18.sslip.io/api; saúde `/health`, HTTPS e banco conectado confirmados após a troca.
- PostgreSQL migrado de `f3b5a7c9d1e2` para **`f5d7b9c1e3a6`**, aplicando Efí (`f4c6a8b0d2e4`) e histórico financeiro (`f5d7b9c1e3a6`).
- Autenticação administrativa, saúde interna, listagem de fornecedores, produtos por estabelecimento e busca `agua`: respostas válidas no clone, localhost e API pública. A conta existente foi preservada; credenciais não são versionadas.

## Commits separados por módulo

| Commit | Alteração |
|---|---|
| `5aac251` | chore(repo): excluir artefatos locais e proteger contexto Docker |
| `31b9571` | chore(backend): atualizar dependencias e isolar banco de testes |
| `be2127a` | fix(security): reforcar tenant, autorizacao e documentos privados |
| `5049e90` | fix(checkout): validar pagamentos e serializar estoque e credito |
| `051f7dd` | fix(billing): persistir eventos confirmados e deduplicar webhooks Efi |
| `e21576c` | feat(consultor): recuperar evidencias e configurar provedores LLM |
| `085ac73` | fix(fornecedores): garantir resposta JSON e preservar filtros no fallback |
| `6759444` | fix(financeiro): acumular baixas parciais sem ultrapassar saldo |
| `f59f245` | fix(analytics): substituir indicadores artificiais por calculos observados |
| `1e559dd` | chore(frontend): migrar Tailwind e atualizar componentes e regressao |
| `e151378` | chore(infra): preparar Oracle e parametrizar acesso e Terraform |
| `2e339eb` | test(erp): registrar lacunas de aceite e separar CI PostgreSQL |
| `4b70c64` | docs(cto): registrar auditoria e coordenacao de sprints por IA |
| `de6721f` | fix(financeiro): persistir baixas idempotentes e validar valores antes do deploy |
| `7d350e6` | fix(ci): corrigir YAML e executar aceites financeiros em PostgreSQL |
| `9578962` | fix(busca): evitar overflow SQLite e normalizar acentos por dialeto |
| `bb98b80` | feat(devops): controlar release Oracle com ensaio, backup e rollback |
| `6d95713` | test(financeiro): liberar transacao antes do ensaio DDL PostgreSQL |

Além destes 18 commits, o commit operacional deste relatório permite reutilizar um CI bem-sucedido exclusivamente para a revisão OCI correspondente e o workflow `.github/workflows/ci.yml`. O ensaio de clone, migração e smoke continua obrigatório. O merge e o registro operacional completam a cadeia em `master`.

## Verificação efetivamente executada

- CI GitHub completo da imagem: **sucesso**, https://github.com/Mald1vas-Tech-Solut1ons/mercadinhosys/actions/runs/37709904474.
- Backend completo em SQLite: **236 passed, 11 skipped e 7 xfailed**. Os 11 casos dependentes de PostgreSQL são executados separadamente; falhas esperadas representam lacunas conhecidas, não funcionalidades aprovadas.
- PostgreSQL 15 real no CI: **53 passed**, cobrindo concorrência de checkout/baixas, migração reversível, idempotência, isolamento de tenant, respostas de fornecedores e pagamentos parciais.
- Oracle: **11 testes de concorrência concluídos** (9 checkout e 2 financeiros) no ensaio inicial. A repetição ampliada de 132 testes foi interrompida na VM Micro após confirmar o CI, sem atribuir sucesso à parte interrompida.
- Ensaio definitivo na Oracle: clone do banco operacional, aplicação das migrações, comparação de contagens e smoke autenticado **aprovados**. Evidência CI `37709904474` validada pelo SHA da imagem; nenhum teste destrutivo foi executado no banco operacional.
- TypeScript e Vite: build local e CI aprovados. Bundle público da Vercel contém a API HTTPS Oracle.
- Segurança: revisão dos diffs, validação de valores financeiros finitos e idempotentes, concorrência transacional, filtros tenant e resposta de fallback; ambientes, chaves privadas, certificados e dumps ficaram fora dos commits. A execução passou por revisão e testes; não representa certificação universal de segurança.

## Dados preservados e retorno à imagem anterior

Contagens comparadas antes/depois da migração e da troca: `{"estabelecimentos": 5, "funcionarios": 37, "produtos": 133, "vendas": 2834, "contas_pagar": 114}`.

Ensaio: `/home/ubuntu/mercadinhosys-releases/6d95713cf189/stage-result.json`.
Publicação: `/home/ubuntu/mercadinhosys-releases/6d95713cf189/deploy-result.json` e `/home/ubuntu/mercadinhosys/.release.json`.
Backup anterior em formato custom: `/home/ubuntu/mercadinhosys-releases/6d95713cf189/database-before.dump`, com índice `pg_restore --list` validado e permissão privada.
Imagem anterior preservada: `sha256:20f533e7bb0c6501f9dd258e45b9366bdd8b81bfb7b24d987aad9aad2cc4aa4b`, também marcada `oracle-backend:rollback-6d95713cf189`.

Rollback do backend, na VM:

```bash
python3 /home/ubuntu/mercadinhosys-releases/6d95713cf189/infra/oracle/release.py rollback --release 6d95713cf189
```

O rollback restaura a imagem anterior, preservando volumes e as migrações aditivas. Não restaura dados automaticamente. A versão Vercel anterior para rollback é `dpl_FxoNHMV9kV3oyYcZSAtbUUFLbUnM`.

Os 7.194 artefatos locais de cache/runtime foram excluídos do escopo Git e mantidos em disco. Os 233 arquivos candidatos da cópia original foram preservados em `scratch/git-review/root-before-reconcile/`, com manifesto antes de reconciliar o checkout. As duas fotografias comerciais locais permaneceram privadas. Não foi usado force-push, reset destrutivo, seed, limpeza de volumes ou rotação de credenciais.

## Limites para receber uma distribuidora/importadora

A instalação usa dados simulados, VM OCI Micro com 1 GB de RAM, PostgreSQL 15, Redis 7, Gunicorn com 1 worker/4 threads e Caddy HTTPS. Não foi homologada para carga empresarial, alta disponibilidade ou recuperação após perda da VM. Manter backup externo e dimensionar infraestrutura antes da entrada de dados reais.

Os **7 aceites pendentes** documentados no backlog são: recebimento parcial, totais SFA inconsistentes, estoque na entrega, lotes SFA, CMP fracionário, lotes vencidos e CMV histórico. Não tratar esta release como aprovação de migração empresarial. Fiscal real, cobranças externas, SMTP e importação/desembaraço precisam de homologação específica. As correções financeiras e de fornecedores desta release estão verificadas nos cenários acima.

## Correção posterior do smoke e de fornecedores

O smoke inicial aceitou fallback e não comprovou métricas nem o escopo solicitado por query string. A correção e a nova publicação efetivamente verificadas estão em [incidente fornecedores](INCIDENTE_SENTRY_FORNECEDORES_2026-10-07.md). As afirmações anteriores sobre resposta HTTP válida não equivalem a aprovação do caminho principal.
