#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
sha=${1:?expected commit required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
runid=${2:?workflow run and attempt required}
[[ "$runid" =~ ^[0-9]+-[0-9]+$ ]]
project=/opt/cats-pajamas-club
state=/var/backups/cats-pajamas-release/ci-$sha-$runid
scratch=/var/tmp/cats-ci-$sha-$runid
cd "$project"
[[ $(git branch --show-current) == main ]]
[[ -z $(git status --porcelain --untracked-files=no) ]]
git fetch origin main
[[ $(git rev-parse origin/main) == "$sha" ]]
[[ ! -e "$state" && ! -L "$state" && ! -e "$scratch" && ! -L "$scratch" ]]
install -d -m 700 "$state"
# Inspect enabled files only; resolve symlinks without reading TLS key material.
config=$(python3 - <<'PY'
from pathlib import Path
matches=set()
for entry in Path('/etc/nginx/sites-enabled').iterdir():
    target=entry.resolve(strict=True)
    assert str(target).startswith(('/etc/nginx/sites-available/', '/etc/nginx/sites-enabled/'))
    if target.is_file() and 'root /opt/cats-pajamas-club/dist_current;' in target.read_text():
        matches.add(str(target))
assert len(matches)==1, 'Expected exactly one enabled application configuration'
print(matches.pop())
PY
)
printf '%s\n' "$config" > "$state/config-path"
cp -p -- "$config" "$state/before.conf"
systemctl start cats-pajamas-backup.service
[[ $(systemctl show cats-pajamas-backup.service -p Result --value) == success ]]
git worktree add --detach "$scratch" "$sha" >/dev/null
bundle_accepted=0
cleanup() {
  code=$?
  trap - EXIT
  # A later gate failure restores this run's builder/helper transaction only.
  # An already-installed matching bundle has no receipt and stays untouched.
  if (( code != 0 && bundle_accepted == 0 )) && [[ -f "$state/backup-builder-rollback/receipt.json" ]]; then
    if ! python3 -B "$state/backup-builder-install.py" --state "$state" --rollback; then
      echo 'Backup builder rollback requires operator attention.' >&2
      code=1
    fi
  fi
  cd "$project"
  if [[ "$scratch" == "/var/tmp/cats-ci-$sha-$runid" && ! -L "$scratch" ]]; then
    git worktree remove --force "$scratch" >/dev/null || code=1
  else code=1; fi
  exit "$code"
}
trap cleanup EXIT
chmod 755 "$scratch"
cd "$scratch"
[[ ! -e .env ]]
npm ci --no-audit --no-fund
npm run build
node ops/prepare-nginx-404.mjs "$state/before.conf" "$state/candidate.conf"
python3 ops/test_nginx_404.py "$state/candidate.conf" "$scratch/dist"
# Observational source audit: bounded, redacted, and read-only. UNKNOWN scope
# does not replace the restore gate or block an otherwise safe release.
if ! timeout 30 python3 -B ops/backup-scope-audit.py --nginx-config "$state/before.conf"; then
  echo 'UNKNOWN backup_source_scope audit_unavailable=true'
fi
# Verify the fresh archive in a disposable, offline container before changing
# application code or its additive settings schema. Use the installed DB image.
db_image=$(docker inspect supabase-db --format '{{.Image}}')
bash ops/ci-backup-restore.sh "$db_image" "$scratch/ops/backup-restore-proof.py"
# Preserve the old verified archive before upgrading the backup producer. Code
# is copied from this exact checked commit into trusted root-only release state;
# the installer refuses /var/tmp candidates and pins both reviewed file hashes.
install -m 700 ops/backup-builder-install.py "$state/backup-builder-install.py"
install -m 700 ops/backup-builder.sh "$state/backup-builder.sh"
install -m 700 ops/backup-runtime-media.py "$state/backup-runtime-media.py"
python3 -B "$state/backup-builder-install.py" --state "$state" \
  --candidate "$state/backup-builder.sh" --helper "$state/backup-runtime-media.py"
backup_started=$(date +%s)
systemctl start cats-pajamas-backup.service
[[ $(systemctl show cats-pajamas-backup.service -p Result --value) == success ]]
# A manifest-bearing archive must pass both media and isolated database restore
# before any application migration or release. The previous copy is preserved.
bash ops/ci-backup-restore.sh "$db_image" "$scratch/ops/backup-restore-proof.py" \
  "$state/backup-runtime-media.py" "$backup_started"
timeout 60 docker exec -i supabase-db psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  < supabase/migrations/20261014152121_app_config_revision.sql
echo 'PASS additive app_config revision migration'
# Apply only this additive RPC migration before activating RPC-backed code.
# Old application rollback keeps the functions; no historical migration replay.
timeout 60 docker exec -i supabase-db psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  < supabase/migrations/20261014202634_atomic_content_reorder.sql
echo 'PASS additive atomic content reorder migration'
printf '%s\n' "$sha" > "$state/preflight-passed"
bundle_accepted=1
echo "PASS production preflight commit=$sha backup=true isolated_nginx=true"
