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
cleanup() {
  cd "$project"
  [[ "$scratch" == "/var/tmp/cats-ci-$sha-$runid" && ! -L "$scratch" ]] || return 1
  git worktree remove --force "$scratch" >/dev/null
}
trap cleanup EXIT
chmod 755 "$scratch"
cd "$scratch"
[[ ! -e .env ]]
npm ci --no-audit --no-fund
npm run build
node ops/prepare-nginx-404.mjs "$state/before.conf" "$state/candidate.conf"
python3 ops/test_nginx_404.py "$state/candidate.conf" "$scratch/dist"
# Verify the fresh archive in a disposable, offline container before changing
# application code or its additive settings schema. Use the installed DB image.
db_image=$(docker inspect supabase-db --format '{{.Image}}')
bash ops/ci-backup-restore.sh "$db_image" "$scratch/ops/backup-restore-proof.py"
timeout 60 docker exec -i supabase-db psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  < supabase/migrations/20261014152121_app_config_revision.sql
echo 'PASS additive app_config revision migration'
printf '%s\n' "$sha" > "$state/preflight-passed"
echo "PASS production preflight commit=$sha backup=true isolated_nginx=true"
