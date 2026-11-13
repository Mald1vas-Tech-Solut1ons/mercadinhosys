# Release de ensaio — evidência (2026-11-13, PR 86)

Objetivo: provar o pipeline novo **sem tocar a produção** e **sem `stage_waived`**.

## O que rodou de verdade (GitHub Actions, run do PR 86)

| Prova | Resultado |
|---|---|
| Build da imagem `linux/amd64` no runner | ok, 1m30s (com cache) a 3m19s (frio) — contra ~25 min na VM |
| Label `org.opencontainers.image.revision` = SHA do commit | conferido pelo workflow |
| Head de migração: `flask db heads` da imagem × analisador do manifesto | `d4a8c2e6f0b1` = `d4a8c2e6f0b1` |
| Ensaio de partida (schema sintético, banco vazio → `create_all` → `stamp head`) | schema carregado, API da imagem sobe, `/api/health` = `healthy`, `database: connected`, 6,4 s |
| Ensaio **com migração pendente** (reaplica a última migração, `d4a8c2e6f0b1`, venda por dose) | upgrade ok, API saudável, downgrade+reupgrade testados em 15,7 s; classificada `reversible: false` (`schema-diferente`) → o rollback automático **não** faria downgrade dela (só a imagem) |
| 60 testes de `release.py`/`release_plan.py`/ensaio com host falso | ok (inclui: sem migração nova exige CI no SHA exato e não exige ensaio; `stage_waived` não destrava migração; downgrade só quando reversível; migração destrutiva exige aceite; lock; rollback com Ctrl+C) |
| Suíte `backend/tests` | 1232 passed, 22 skipped |

Essas provas rodam em todo PR que toque `infra/oracle/`, `backend/Dockerfile` ou `backend/migrations/`.

Os schemas desse ensaio são **sintéticos** (`schema_source: synthetic-create-all`): o `release.py` os
recusa por construção. Só `production-schema-only` (retrato real da produção) é aceito.

## Leitura real da produção (somente leitura, 2026-11-13)

- Banco em `alembic_version = d4a8c2e6f0b1` = head da imagem ativa (`cc865335fd63`).
  Logo, o próximo release **sem migração** cai na regra "sem migração nova": exige só CI verde no SHA exato + imagem por digest.
- VM `x86_64` (mesma arquitetura do runner), Python 3.12, 9,7 GB de disco livre, Docker 29 / Compose v5.
- Backend ativo `healthy`; nada foi alterado.

## Como fazer o primeiro release de verdade (sem waiver)

1. Merge deste PR na master (fast-forward em `main` e `master`).
2. Dono: tornar o pacote GHCR público (ou cadastrar o token de leitura) — ver `RELEASE.md`, seção "O que o dono precisa cadastrar".
3. O próximo push na master (depois do CI verde) publica a imagem e o artefato `release-<sha12>`.
4. `infra/oracle/ship-release.sh <SHA>` → mostra o `plan`; com `--deploy`, aplica.
   Se o release traz migração, antes rodar `migration-rehearsal.yml` (manual ou automático).
