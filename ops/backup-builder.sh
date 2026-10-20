#!/bin/bash
set -euo pipefail
umask 077
mkdir -p /var/backups/cats-pajamas
exec 9>/var/lock/cats-pajamas-backup.lock
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%d-%H%M%S)
stage=$(mktemp -d /var/backups/cats-pajamas/.stage-XXXXXX)
trap 'rm -rf "$stage"' EXIT
docker exec supabase-db pg_dump -U postgres -d postgres | gzip > "$stage/database.sql.gz"
cp /opt/cats-pajamas-club/.env "$stage/app.env"
cp /opt/supabase/docker/.env "$stage/supabase.env"
cp /etc/nginx/sites-available/cats-pajamas-club "$stage/nginx.conf"
tar -czf "$stage/runtime-uploads.tar.gz" -C /opt cats-pajamas-uploads
python3 /usr/local/lib/cats-backup-runtime/backup-runtime-media.py capture "$stage/runtime-uploads.tar.gz" /opt/cats-pajamas-uploads "$stage/database.sql.gz" "$stage/runtime-manifest.json"
tar -czf "$stage/complete.tar.gz" -C "$stage" \
  database.sql.gz app.env supabase.env nginx.conf runtime-uploads.tar.gz runtime-manifest.json
gzip -t -- "$stage/complete.tar.gz"
tar -tzf "$stage/complete.tar.gz" >/dev/null
# Exclusive same-filesystem publication: incomplete archives never get a final name.
ln -T -- "$stage/complete.tar.gz" "/var/backups/cats-pajamas/$stamp.tar.gz"
find /var/backups/cats-pajamas -maxdepth 1 -type f -name '*.tar.gz' -mtime +14 -delete
