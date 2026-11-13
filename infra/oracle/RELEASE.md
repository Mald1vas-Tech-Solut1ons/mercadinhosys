# Release do backend (VM Oracle) — runbook

A VM de produção (1 GB, dividida com a loja e o `mysuperstore`) **não constrói imagem e não ensaia
migração**. Ela só faz: baixar a imagem por digest → backup validado → migração → troca → smoke
local + público → rollback automático. Build e ensaio rodam no GitHub Actions.

```
push na master ─► ci.yml verde ─► release-image.yml ──► GHCR: mercadinhosys-backend:<sha12> (digest)
                                   │  ci-proof.json (SHA exato) + release-manifest.json
                                   └► migration-rehearsal.yml (schema-only da produção + upgrade + downgrade)
operador ─► ship-release.sh ─► VM: release.py plan → prepare → deploy (rollback automático)
```

## O que cada peça garante

| Peça | Garantia |
|---|---|
| `release-image.yml` | Só constrói se o `ci.yml` terminou **verde no push para a master, no SHA exato**. Imagem com label `org.opencontainers.image.revision=<sha completo>`, publicada por digest. Em PR só valida (sem publicar). |
| `ci-proof.json` | Run do `ci.yml` (`path`, `head_sha`, `status`, `conclusion`, `html_url`, `event`, `head_branch`): o mesmo formato que o `release.py` já aceitava. |
| `release-manifest.json` | SHA, digest, prova de CI e o grafo de migrações (com o que é `DROP`/dados em cada uma). |
| `migration-rehearsal.yml` | Carrega o **schema (sem dados)** da produção num PostgreSQL descartável, aplica as pendentes com a **imagem publicada**, sobe a API e testa o `downgrade`. Anexa o resultado ao manifesto. |
| `release.py` | Recusa tudo que não cumpre as regras abaixo; não existe waiver. O ensaio na VM (`stage`) foi removido. |

## Regras de decisão (`release_plan.py`, testadas em `test_release.py`)

O `release.py` lê a revisão **real** do banco (`alembic_version`) e compara com o head da imagem:

1. **Sem migração nova** (revisão do banco = head da imagem): **não exige ensaio**. Exige CI verde no
   SHA exato (`ci-proof.json`), manifesto coerente, imagem baixada **do digest do manifesto** com o
   label de revisão igual ao SHA. Troca simples; rollback = imagem anterior.
2. **Com migração nova**: exige ensaio aprovado, no schema da produção, para **o mesmo commit e digest**,
   partindo da **revisão atual** do banco, com retrato de no máximo 72 h. Sem isso: recusa.
3. **Revisão do banco desconhecida ou à frente da imagem**: recusa (release mais antiga que o banco, ou
   schema derivado).
4. **Migração destrutiva** (`drop_table`/`drop_column`/SQL com `DROP|TRUNCATE|DELETE`): só com
   `--accept-destructive`, em release próprio, com o código antigo já tolerante à ausência (2 passos:
   parar de usar → depois dropar). O rollback automático nunca faz downgrade nesse caso.
5. Contagens de tabelas-chave podem **subir** durante a troca (a loja vende), nunca **cair**.

### Rollback automático (qualquer falha depois do backup, inclusive Ctrl+C/SIGTERM)

| Situação | O que acontece |
|---|---|
| Sem migração | Volta a imagem anterior, smoke de saúde/login. |
| Migração **reversível** (ensaio: downgrade devolveu o schema idêntico) e só aditiva | Para o backend novo → `flask db downgrade <revisão anterior>` → sobe a imagem anterior. |
| Migração irreversível, com SQL de dados ou alteração de tipo de coluna | Só a imagem volta; o schema fica migrado (aditivo, o código antigo tolera) e o log avisa. Backup em `database-before.dump`. |
| Migração destrutiva (aceita) | Só a imagem volta e o log manda restaurar `database-before.dump` à mão. |

Rollback manual depois que a release ficou no ar: `release.py rollback --release SHA12` (só a imagem);
`--downgrade` também desfaz a migração, e só é aceito quando a migração é reversível e aditiva.

Limite conhecido: o ensaio é **só de schema**. Migrações que transformam dados (`UPDATE`, backfill) são
classificadas como `data_ops` (sem downgrade automático) e devem ter teste de unidade com dados sintéticos.

## O que o dono precisa cadastrar (uma vez)

Nenhum segredo vai para o repositório nem para logs.

**A. Imagem no GHCR** (obrigatório). O workflow publica com o `GITHUB_TOKEN` do próprio run, sem segredo.
Depois do 1º release, em *GitHub → Packages → mercadinhosys-backend → Package settings*:
- **Opção recomendada:** *Change visibility → Public*. A imagem só contém o código que já é público no
  repositório (o build parte dos arquivos versionados; `.env`, chaves e dados não entram). A VM então não
  precisa de credencial nenhuma.
- **Opção privada:** criar um token clássico com **somente `read:packages`** e, na VM, uma vez:
  `echo <token> | sudo docker login ghcr.io -u <usuario> --password-stdin`.

**B. Ensaio de migração.** Há dois caminhos; use um.
- **Manual (nada a cadastrar):** antes de uma release com migração, no seu computador:
  ```bash
  ssh ... ubuntu@144.22.151.18 /home/ubuntu/mercadinhosys/infra/oracle/schema-export.sh | gzip -9 | base64 -w0 > snap.b64
  gh workflow run migration-rehearsal.yml -f sha=<SHA completo> -f schema_snapshot_gz_b64="$(cat snap.b64)"
  ```
- **Automático em todo push na master** (recomendado): chave SSH dedicada que só consegue rodar o export de schema.
  1. Gerar: `ssh-keygen -t ed25519 -N '' -f gha-schema -C gha-schema-ensaio`.
  2. Na VM, em `~ubuntu/.ssh/authorized_keys`, **uma linha**:
     `command="/home/ubuntu/mercadinhosys/infra/oracle/schema-export.sh",restrict ssh-ed25519 AAAA... gha-schema-ensaio`
     (com `command=` + `restrict`, a chave não abre shell, não faz túnel nem scp).
     `schema-export.sh` precisa existir nesse caminho: copie-o na primeira vez (`scp`); a VM não é tocada por este PR.
  3. No GitHub (*Settings → Secrets and variables → Actions*):
     - Secret `ORACLE_SCHEMA_SSH_KEY` = conteúdo de `gha-schema` (chave **privada**);
     - Variable `ORACLE_HOST` = `144.22.151.18`;
     - Variable `ORACLE_SSH_KNOWN_HOSTS` = a linha do host (`ssh-keyscan -t ed25519 144.22.151.18`, conferida contra o `known_hosts` que você já usa);
     - Variable `ORACLE_SCHEMA_VIA_SSH` = `true` (liga o job automático).
  4. A porta 22 da VM precisa aceitar os runners do GitHub (IPs variáveis). Se a *security list* da Oracle
     restringe por IP, use o caminho manual.

**C. Operador.** Quem publica precisa de `gh` autenticado e da chave SSH de operação (a que já existe,
fora do git). Nada novo.

## Publicar uma release

1. PR aprovado e mergeado na master por fast-forward (`main` e `master` iguais). Esperar `MercadinhoSys CI`
   e depois **Release Image** ficarem verdes (a imagem e o artefato `release-<sha12>` aparecem no resumo do run).
2. Se a release tem migração nova, o ensaio precisa ter rodado (automático ou manual, seção B) e gerado
   `release-<sha12>-rehearsed`. Não sabe se tem? Faça o passo 3; o `plan` diz.
3. Do seu computador (na raiz do repositório):
   ```bash
   ORACLE_KEY=... ORACLE_KNOWN_HOSTS=... infra/oracle/ship-release.sh <SHA completo>
   ```
   Baixa o artefato, manda o pacote (scripts do commit + manifesto + prova) e roda `release.py plan` na VM
   (**só lê**). A saída mostra `kind: no-migration` ou `migrate`, as revisões pendentes e se o rollback pode
   fazer downgrade. Se recusar, a mensagem diz o que falta.
4. Para aplicar: o mesmo comando com `--deploy` (roda `prepare` — baixa por digest, confere — e dispara o
   `deploy` em segundo plano; uma queda do SSH não interrompe o rollback automático). Acompanhe:
   `ssh ... 'tail -f /home/ubuntu/mercadinhosys-releases/<sha12>/deploy.out'`.
   Opcional: `EXPECTED_IMAGE=sha256:<imagem ativa>` faz o deploy recusar se outra coisa entrou no meio.
5. Conferir: `docker inspect oracle-backend-1` com o label `org.opencontainers.image.revision` = SHA, health
   `healthy`, `deploy-result.json` com `status: deployed`.
6. Frontend (Vercel) só depois do backend, como antes (CLI, a partir do clone de deploy).

Uma operação por vez: o `release.py` mantém `/home/ubuntu/mercadinhosys-releases/.release.lock` e recusa
uma segunda execução (lock órfão de processo morto é descartado sozinho).

## Mudanças em relação ao fluxo antigo

- Sumiram da VM: `docker build` (~25 min, PSI ~47%), `release.py stage`, clone do banco (41 min na última
  tentativa), segundo backend, pytest. `stage` agora só imprime a explicação.
- `stage_waived` não existe mais: nenhum arquivo na pasta da release libera uma migração sem ensaio.
- O deploy não copia mais o código para `/home/ubuntu/mercadinhosys/backend` (o container nunca montou essa
  pasta; a cópia já travou deploys com arquivos de `root`). Gravar `.release.json`/tag `latest` que falhe
  vira aviso, não rollback.
- Backup em streaming para disco (antes ficava inteiro na memória do Python).
- Prazos do smoke agora estão no código (requisição 90 s, saúde 300 s); o ajuste manual na cópia da VM some.
- Antes de baixar: confere ≥ 2 GB livres. Imagens antigas acumulam; limpar de vez em quando com
  `sudo docker image prune -a --filter "until=720h"` (nunca remova a imagem ativa nem a `rollback-*`).
- `publicar_backend2.sh` (script solto da VM) deixa de servir: use `ship-release.sh`.

## Release de ensaio (sem tocar a produção)

Prova de que o pipeline funciona sem `stage_waived`, registrada em [RELEASE-ENSAIO.md](RELEASE-ENSAIO.md).
Reproduzir a qualquer momento: abrir um PR que toque `infra/oracle/` ou `backend/Dockerfile` roda, em modo
somente-validação, build da imagem, conferência do head de migração, ensaio de partida (API da imagem sobe
saudável sobre um schema recém-criado) e as 60 provas de `test_release.py` (plan/deploy/rollback com host
falso). Em produção, `release.py plan` é a leitura segura equivalente.
