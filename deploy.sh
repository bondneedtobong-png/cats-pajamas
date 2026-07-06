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

# Атомарный деплой без даунтайма: собираем в свежую папку releases/<ts>, затем
# ОДНИМ вызовом ln -sfn (это rename() под капотом) переключаем симлинк
# dist_current на новый релиз. nginx раздаёт root=/opt/cats-pajamas-club/dist_current,
# поэтому подмена мгновенная — гость никогда не попадает на полупустой dist во
# время сборки (раньше `npm run build` на секунды очищал живой dist → короткие 500).
# Прод-требование (уже настроено на сервере): nginx root = .../dist_current (симлинк).
# Heredoc в кавычках ('EOF') — $VAR/$() исполняются НА СЕРВЕРЕ; PROJECT_PATH
# прокидываем окружением.
ssh "$HOST" "PROJECT_PATH='$PROJECT_PATH' bash -s" <<'EOF'
set -e
cd "$PROJECT_PATH"
echo "→ git pull"
git pull --ff-only
echo "→ npm ci"
npm ci
echo "→ npm run build (в отдельную папку-релиз)"
npm run build
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p releases
rm -rf "releases/$TS"
mv dist "releases/$TS"
ln -sfn "releases/$TS" dist_current
echo "→ dist_current → releases/$TS (атомарное переключение, без даунтайма)"
# держим последние 5 релизов (для мгновенного отката), старьё чистим
ls -1dt releases/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
echo "→ pm2 restart (api + bot, если бот уже запущен)"
pm2 restart cats-api
pm2 restart cats-bot 2>/dev/null || echo "  (cats-bot не запущен — это ожидаемо)"
echo "→ статус"
pm2 list
EOF

echo "✅ Готово."
