#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .deploy-info ]; then
  echo "Нет .deploy-info — сервер ещё не настроен."
  exit 1
fi

SERVER=$(grep '^server:' .deploy-info | cut -d' ' -f2)
SSH_ALIAS=$(grep '^ssh_host_alias:' .deploy-info | cut -d' ' -f2)
PROJECT_PATH=$(grep '^project_path_on_server:' .deploy-info | cut -d' ' -f2)
HOST="${SSH_ALIAS:-$SERVER}"

echo "→ Деплою на $HOST ($PROJECT_PATH)"

ssh "$HOST" bash <<EOF
set -e
cd $PROJECT_PATH
echo "→ git pull"
git pull --ff-only
echo "→ npm ci"
npm ci
echo "→ npm run build"
npm run build
echo "→ pm2 restart (api + bot, если бот уже запущен)"
pm2 restart cats-api
pm2 restart cats-bot 2>/dev/null || echo "  (cats-bot не запущен — это ожидаемо, пока бот на Vercel)"
echo "→ статус"
pm2 list
EOF

echo "✅ Готово."
