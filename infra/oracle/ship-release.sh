#!/usr/bin/env bash
# Leva uma release já construída no Actions até a VM de produção (máquina do operador, com gh e SSH).
#
#   infra/oracle/ship-release.sh <SHA-completo>            # envia o pacote e roda `release.py plan` (só lê)
#   infra/oracle/ship-release.sh <SHA-completo> --deploy   # idem + prepare + deploy em segundo plano na VM
#
# Variáveis: ORACLE_HOST (padrão 144.22.151.18), ORACLE_KEY e ORACLE_KNOWN_HOSTS (chave e known_hosts do
# operador, fora do git), EXPECTED_IMAGE (opcional: ID da imagem ativa que o deploy deve substituir).
# Nunca imprime nem grava a chave. O deploy recusa sozinho o que não cumpre as regras (release_plan.py).
set -euo pipefail

sha="${1:?uso: ship-release.sh <SHA-completo de 40 caracteres> [--deploy]}"
mode="${2:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA precisa ter 40 caracteres hexadecimais" >&2; exit 1; }
[[ -z "$mode" || "$mode" == "--deploy" ]] || { echo "argumento desconhecido: $mode" >&2; exit 1; }
sha12="${sha:0:12}"
host="${ORACLE_HOST:-144.22.151.18}"
key="${ORACLE_KEY:-scratch/oracle-access.key}"
known="${ORACLE_KNOWN_HOSTS:-scratch/oracle-known-hosts}"
remote_root="/home/ubuntu/mercadinhosys-releases/$sha12"
ssh_opts=(-i "$key" -o UserKnownHostsFile="$known" -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o BatchMode=yes)
remote() { ssh "${ssh_opts[@]}" "ubuntu@$host" "$@"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Com migração nova existe o artefato "-rehearsed" (manifesto com o ensaio anexado); sem ela, o base basta.
run_id="$(gh run list --workflow release-image.yml --commit "$sha" --status success --limit 1 --json databaseId --jq '.[0].databaseId')"
[[ -n "$run_id" && "$run_id" != "null" ]] || { echo "Sem run verde do release-image.yml para $sha" >&2; exit 1; }
download() { gh run download "$1" --name "$2" --dir "$work/pkg" 2>/dev/null; }
rehearsal_run="$(gh run list --workflow migration-rehearsal.yml --commit "$sha" --status success --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
if [[ -n "$rehearsal_run" && "$rehearsal_run" != "null" ]] && download "$rehearsal_run" "release-$sha12-rehearsed"; then
  echo "artefato: release-$sha12-rehearsed (ensaio manual, run $rehearsal_run)"
elif download "$run_id" "release-$sha12-rehearsed"; then
  echo "artefato: release-$sha12-rehearsed (ensaio automático, run $run_id)"
elif download "$run_id" "release-$sha12"; then
  echo "artefato: release-$sha12 (sem ensaio: só serve se a release não traz migração nova)"
else
  echo "Nenhum artefato da release $sha12 encontrado" >&2; exit 1
fi
[[ -s "$work/pkg/release-manifest.json" && -s "$work/pkg/ci-proof.json" ]] || { echo "artefato incompleto" >&2; exit 1; }

# Pacote = scripts do commit exato + contratos do smoke. Nada de código do backend: ele vai na imagem.
git archive --format=tar "$sha" infra/oracle backend/app/utils/release_smoke_contracts.py > "$work/package.tar"
remote "mkdir -p '$remote_root'"
ssh "${ssh_opts[@]}" "ubuntu@$host" "tar -x -C '$remote_root'" < "$work/package.tar"
ssh "${ssh_opts[@]}" "ubuntu@$host" "cat > '$remote_root/release-manifest.json'" < "$work/pkg/release-manifest.json"
ssh "${ssh_opts[@]}" "ubuntu@$host" "cat > '$remote_root/ci-proof.json'" < "$work/pkg/ci-proof.json"
echo "pacote enviado para $remote_root"

script="$remote_root/infra/oracle/release.py"
remote "python3 '$script' plan --release '$sha12'"

if [[ "$mode" == "--deploy" ]]; then
  extra=""
  [[ -n "${EXPECTED_IMAGE:-}" ]] && extra="--expected-image '$EXPECTED_IMAGE'"
  remote "python3 '$script' prepare --release '$sha12'"
  # Em segundo plano: uma queda do SSH no meio da troca não pode interromper o rollback automático.
  remote "cd '$remote_root' && setsid nohup python3 '$script' deploy --release '$sha12' $extra > deploy.out 2>&1 < /dev/null & disown; echo deploy iniciado"
  echo "acompanhe: ssh ... 'tail -f $remote_root/deploy.out'"
fi
