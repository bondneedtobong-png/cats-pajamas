#!/bin/sh
set -eu
if [ "${SSH_ORIGINAL_COMMAND-}" != export-latest ] || [ -n "${SSH_TTY-}" ]; then
  echo 'Backup command rejected' >&2
  exit 1
fi
exec /usr/bin/node /usr/local/lib/cats-backup/backup-channel.mjs export
