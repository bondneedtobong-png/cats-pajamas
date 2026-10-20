#!/usr/bin/env bash
# Root-only checked release gate. Uses an already-installed immutable image.
set -Eeuo pipefail
umask 077
stage=prerequisites
work=''
container=''
owned=0
cleanup() {
  code=$?
  trap - EXIT
  if [[ $owned == 1 && "$container" =~ ^cats-restore-[0-9]+-[a-f0-9]{12}$ ]]; then
    if docker inspect "$container" >/dev/null 2>&1; then
      if [[ $(docker inspect "$container" --format '{{index .Config.Labels "cats.restore.proof"}}') == true ]]; then
        docker rm -f -v "$container" >/dev/null 2>&1 || code=1
      else code=1; fi
    fi
  fi
  if (( code != 0 )) && [[ -n "$work" && -d "$work" && ! -L "$work" ]]; then
    python3 "$helper" diagnostics "$work" >&2 || true
  fi
  if [[ -n "$work" && "$work" =~ ^/var/tmp/cats-restore\.[a-zA-Z0-9]{8}$ && -d "$work" && ! -L "$work" && $(stat -c %u "$work") == 0 ]]; then
    rm -rf -- "$work"
  fi
  if (( code != 0 )); then printf 'FAIL isolated backup restore stage=%s\n' "$stage" >&2; fi
  exit "$code"
}
trap cleanup EXIT
[[ $(id -u) == 0 ]]
image=${1:?immutable installed Supabase PostgreSQL image ID required}
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ $(docker image inspect "$image" --format '{{.Id}}' 2>/dev/null) == "$image" ]]
helper=${2:?checked backup-restore-proof.py path required}
[[ -f "$helper" && ! -L "$helper" ]]
media_helper=${3:-}
if [[ -n "$media_helper" ]]; then [[ -f "$media_helper" && ! -L "$media_helper" ]]; fi
minimum_created=${4:-0}
[[ "$minimum_created" =~ ^[0-9]{1,12}$ ]]
for executable in python3 docker sha256sum timeout; do command -v "$executable" >/dev/null; done
work=$(mktemp -d /var/tmp/cats-restore.XXXXXXXX)
chmod 700 "$work"
container="cats-restore-$$-$(python3 -c 'import secrets; print(secrets.token_hex(6))')"
stage=archive
archive=$(python3 - "$minimum_created" <<'PY'
from pathlib import Path
import re,time,sys
root=Path('/var/backups/cats-pajamas')
assert root.is_dir() and not root.is_symlink()
items=sorted(p for p in root.iterdir() if re.fullmatch(r'\d{8}-\d{6}\.tar\.gz',p.name))
assert items
p=items[-1]
assert p.is_file() and not p.is_symlink() and p.stat().st_uid==0
assert 0 < p.stat().st_size <= 512*1024*1024
assert 0 <= time.time()-p.stat().st_mtime < 3600
assert p.stat().st_mtime >= int(sys.argv[1]), 'Fresh archive from this backup start required'
print(p)
PY
)
# Snapshot the owned input to prevent backup rotation/change during verification.
cp -- "$archive" "$work/archive.tar.gz"
archive_sha=$(sha256sum "$work/archive.tar.gz" | cut -d' ' -f1)
photo_restore=unproven
if [[ -n "$media_helper" ]]; then
  stage=runtime_media
  timeout 180 python3 -B "$media_helper" verify-backup "$work/archive.tar.gz" >"$work/media-proof.json" 2>"$work/media.log"
  photo_restore=manifest_verified
fi
python3 "$helper" prepare "$work/archive.tar.gz" "$work" >"$work/prepare.log" 2>&1
stage=container
# Bare initdb, no image initialization scripts, host ports, production mounts, or network.
! docker inspect "$container" >/dev/null 2>&1
owned=1
docker create --name "$container" --label cats.restore.proof=true --network none --memory 768m --cpus 1 --pids-limit 256 --user postgres --tmpfs /tmp:rw,mode=1777,size=512m --entrypoint bash "$image" -ceu '
  umask 077
  printf "%s\n" restore-fixture-only >/tmp/fixture-password
  initdb -D /tmp/restore-db -U postgres --pwfile=/tmp/fixture-password --auth-local=trust --auth-host=scram-sha-256 >/tmp/init.log 2>&1
  exec postgres -D /tmp/restore-db -c listen_addresses= -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_net -c pg_net.database_name=postgres
' >"$work/create.log" 2>&1
owned=1
docker start "$container" >"$work/start.log" 2>&1
[[ $(docker inspect "$container" --format '{{.HostConfig.NetworkMode}}') == none ]]
stage=ready
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready -h /tmp -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ $ready == 1 ]]
stage=roles
timeout 180 docker exec -i "$container" psql -h /tmp -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f - <"$work/roles.sql" >"$work/roles.log" 2>&1
stage=sql
timeout 180 docker exec -i "$container" psql -h /tmp -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f - <"$work/database.sql" >"$work/sql.log" 2>&1
stage=content
timeout 180 python3 "$helper" verify "$work" "$container" >"$work/proof.json" 2>"$work/verify.log"
printf 'PASS isolated backup restore archive=%s sha256=%s network=none photo_restore=%s\n' "${archive##*/}" "$archive_sha" "$photo_restore"
cat "$work/proof.json"
if [[ -n "$media_helper" ]]; then cat "$work/media-proof.json"; fi
