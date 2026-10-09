#!/usr/bin/env bash
set -euo pipefail

# Run locally. Server secrets/backups and targeted DB migrations are prepared
# separately; this script never rewrites .env or applies schema.sql.
if [[ ! -f .deploy-info ]]; then
  echo 'Нет .deploy-info — сервер ещё не настроен.' >&2
  exit 1
fi
read_info() {
  local line value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    if [[ "$line" == "$1:"* ]]; then
      value=${line#*:}
      value=${value#"${value%%[![:space:]]*}"}
      printf '%s' "$value"
      return 0
    fi
  done < .deploy-info
}
SERVER=$(read_info server)
SSH_ALIAS=$(read_info ssh_host_alias)
PROJECT_PATH=$(read_info project_path_on_server)
HOST=${SSH_ALIAS:-$SERVER}
if [[ ! "$HOST" =~ ^[[:alnum:]_.@:-]+$ || "$HOST" == -* || "$PROJECT_PATH" != /* || "$PROJECT_PATH" == / || "$PROJECT_PATH" == *$'\n'* || "$PROJECT_PATH" == *$'\r'* ]]; then
  echo 'Некорректный адрес или путь в .deploy-info.' >&2
  exit 1
fi
printf -v QUOTED_PATH '%q' "$PROJECT_PATH"
echo "→ Выпуск на $HOST ($PROJECT_PATH)"
ssh -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  "$HOST" "bash -s -- $QUOTED_PATH" <<'REMOTE'
set -Eeuo pipefail
cd -- "$1"
PROJECT_ROOT=$(pwd -P)
cd -- "$PROJECT_ROOT"
die() { echo "Ошибка: $*" >&2; return 1; }
for tool in git npm node pm2 curl realpath timeout; do command -v "$tool" >/dev/null || die "нет $tool"; done
[[ "$(cd -- "$(git rev-parse --show-toplevel)" && pwd -P)" == "$PROJECT_ROOT" ]] || die 'путь не является корнем репозитория'
[[ "$(git branch --show-current)" == main ]] || die 'сервер должен быть на main'
[[ "$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')" == origin/main ]] || die 'main должен отслеживать origin/main'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die 'на сервере есть изменения отслеживаемых файлов'
[[ ! -L dist ]] || die 'dist является ссылкой; сборка может изменить действующий сайт'
for app in cats-api cats-bot; do timeout 10 pm2 describe "$app" >/dev/null || die "нет обязательного процесса $app"; done
# .env is authoritative. Stale PM2 variables are overwritten on restart below.
node --input-type=module -e '
  import fs from "node:fs"; import dotenv from "dotenv";
  const e = dotenv.parse(fs.readFileSync(".env"));
  const ttl = Number(e.SESSION_TTL_SECONDS || 604800);
  if (e.NODE_ENV !== "production" || !e.SESSION_SECRET || Buffer.byteLength(e.SESSION_SECRET) < 32 ||
      !Number.isSafeInteger(ttl) || ttl < 60 || ttl > 2592000 ||
      e.AUTH_DEMO_OTP === "true" || e.ALLOW_DEMO_PAYMENTS === "true") {
    console.error("Ошибка: production-настройки сессий в .env не готовы."); process.exit(1);
  }'
[[ -d releases && ! -L releases && -L dist_current ]] || die 'не найдены releases и dist_current'
OLD_SHA=$(git rev-parse HEAD)
OLD_NAME=$(basename -- "$(readlink -- dist_current)")
valid_release_name() { [[ "$1" =~ ^[0-9]{8}-[0-9]{6}(-[0-9]+)?$ ]]; }
[[ "$OLD_NAME" =~ ^[[:alnum:]][[:alnum:]_-]*$ ]] || die 'предыдущий релиз имеет неожиданный путь'
[[ ! -L "releases/$OLD_NAME" && "$(realpath -e -- dist_current)" == "$PROJECT_ROOT/releases/$OLD_NAME" ]] || die 'предыдущий релиз вне releases'
OLD_TARGET="releases/$OLD_NAME"
TMP_LINK="$PROJECT_ROOT/.deploy-link-$BASHPID"
[[ ! -e "$TMP_LINK" && ! -L "$TMP_LINK" ]] || die 'временная ссылка уже существует'
mkdir -- .deploy-lock 2>/dev/null || die 'другой выпуск уже выполняется (.deploy-lock)'
MUTATED=0
cleanup_lock() { rm -f -- "$TMP_LINK"; rmdir -- "$PROJECT_ROOT/.deploy-lock"; }
trap cleanup_lock EXIT

atomic_switch() {
  ln -s -- "$1" "$TMP_LINK"
  # A rename replaces the old symlink in one operation; ln -sfn alone does not.
  mv -Tf -- "$TMP_LINK" "$PROJECT_ROOT/dist_current"
}
restart_apps() {
  node --input-type=module -e '
    import fs from "node:fs"; import dotenv from "dotenv"; import { spawnSync } from "node:child_process";
    const fileEnv = dotenv.parse(fs.readFileSync(".env"));
    const env = { ...process.env, ...fileEnv, NODE_ENV: "production",
      SESSION_VERSION: fileEnv.SESSION_VERSION || "1", SESSION_TTL_SECONDS: fileEnv.SESSION_TTL_SECONDS || "604800",
      AUTH_DEMO_OTP: "false", ALLOW_DEMO_PAYMENTS: "false" };
    let failed = false;
    for (const app of ["cats-api", "cats-bot"]) {
      const result = spawnSync("pm2", ["restart", app, "--update-env"], { env, timeout: 30000, stdio: ["ignore", "ignore", "inherit"] });
      if (result.error || result.status !== 0) { console.error("Не удалось перезапустить " + app); failed = true; }
    }
    process.exit(failed ? 1 : 0);'
}
process_snapshot() {
  # PM2 JSON contains environment secrets. Only this parser sees it; stdout
  # contains process names, PIDs and restart counters, never the raw document.
  timeout 10 pm2 jlist | node --input-type=module -e '
    import fs from "node:fs"; import dotenv from "dotenv";
    const e = dotenv.parse(fs.readFileSync(".env"));
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      try {
        const apps = JSON.parse(input);
        const selected = ["cats-api", "cats-bot"].map(name => apps.find(app => app.name === name));
        if (selected.some(app => {
          if (!app || !app.pid) return true;
          const p = app.pm2_env;
          return p.status !== "online" || p.NODE_ENV !== "production" || p.SESSION_SECRET !== e.SESSION_SECRET ||
            (p.SESSION_VERSION || "1") !== (e.SESSION_VERSION || "1") ||
            Number(p.SESSION_TTL_SECONDS || 604800) !== Number(e.SESSION_TTL_SECONDS || 604800) ||
            p.AUTH_DEMO_OTP === "true" || p.ALLOW_DEMO_PAYMENTS === "true";
        })) process.exit(1);
        console.log(selected.map(app => `${app.name}:${app.pid}:${app.pm2_env.restart_time}`).join("|"));
      } catch { process.exit(1); }
    });'
}
wait_healthy() {
  local attempt snapshot previous='' stable=0
  # At most 20 checks; five consecutive matching process snapshots are required.
  # HTTP timeout and polling are bounded. This is readiness, not a DB smoke test.
  for ((attempt=1; attempt<=20; attempt++)); do
    if snapshot=$(process_snapshot 2>/dev/null) && \
      curl -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:3001/health 2>/dev/null | node -e '
        let input = ""; process.stdin.on("data", chunk => input += chunk);
        process.stdin.on("end", () => { try { process.exit(JSON.parse(input).ok === true ? 0 : 1); } catch { process.exit(1); } });'; then
      if [[ "$snapshot" == "$previous" ]]; then stable=$((stable + 1)); else stable=1; fi
      previous=$snapshot
      if ((stable >= 5)); then return 0; fi
    else
      previous=''; stable=0
    fi
    if ((attempt < 20)); then sleep 2; fi
  done
  return 1
}
on_failure() {
  local status=${1:-$?} rollback_ok=1
  trap - ERR INT TERM HUP
  set +e
  echo "Ошибка выпуска (код $status)." >&2
  if [[ "$MUTATED" == 1 ]]; then
    echo '→ Откат сайта, кода API/бота и зависимостей'
    atomic_switch "$OLD_TARGET" || rollback_ok=0
    git reset --hard "$OLD_SHA" >/dev/null || rollback_ok=0
    npm ci --no-audit --no-fund || rollback_ok=0
    # Attempt both restarts even if one fails; preserve the authoritative .env.
    restart_apps || rollback_ok=0
    wait_healthy || rollback_ok=0
    timeout 10 pm2 save >/dev/null || rollback_ok=0
    if [[ "$rollback_ok" == 1 ]]; then echo '→ Предыдущий выпуск восстановлен'; else echo 'Откат не подтверждён — требуется проверка сервера.' >&2; fi
  fi
  exit 1
}
trap on_failure ERR
trap 'on_failure 130' INT
trap 'on_failure 143' TERM
trap 'on_failure 129' HUP

echo "→ Предыдущий код: $OLD_SHA; сайт: $OLD_TARGET"
git fetch --prune origin
MUTATED=1
git pull --ff-only
echo '→ Установка зависимостей и сборка'
npm ci --no-audit --no-fund
npm run build
# Generators update generatedAt even with identical photos. Restore only that
# metadata-only change; any real content change must be reviewed, not discarded.
node --input-type=module -e '
  import fs from "node:fs"; import { spawnSync } from "node:child_process"; import { isDeepStrictEqual } from "node:util";
  for (const file of ["src/data/galleryPhotos.generated.json", "src/data/cocktailPhotos.generated.json"]) {
    const result = spawnSync("git", ["show", "HEAD:" + file], { encoding: "utf8" });
    if (result.status !== 0) continue;
    try {
      const before = JSON.parse(result.stdout), after = JSON.parse(fs.readFileSync(file, "utf8"));
      delete before.generatedAt; delete after.generatedAt;
      if (!isDeepStrictEqual(before, after)) throw new Error();
      fs.writeFileSync(file, result.stdout);
    } catch { console.error("Сборка изменила содержимое " + file + "; выпуск остановлен."); process.exit(1); }
  }'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die 'сборка изменила отслеживаемые файлы'
[[ -f dist/index.html && -d dist/assets && ! -L dist ]] || die 'сборка не создала ожидаемые файлы'
NEW_NAME="$(date +%Y%m%d-%H%M%S)-$BASHPID"
valid_release_name "$NEW_NAME" || die 'некорректное имя нового релиза'
NEW_TARGET="releases/$NEW_NAME"
[[ ! -e "$NEW_TARGET" && ! -L "$NEW_TARGET" ]] || die 'папка нового релиза уже существует'
mv -- dist "$NEW_TARGET"
# Existing open pages can still request chunks from the preceding release.
if [[ -d "$OLD_TARGET/assets" ]]; then cp -an -- "$OLD_TARGET/assets/." "$NEW_TARGET/assets/"; fi
atomic_switch "$NEW_TARGET"
echo '→ Перезапуск API и бота; проверка готовности'
restart_apps
wait_healthy
timeout 10 pm2 save >/dev/null
echo "→ Готовность подтверждена; код $(git rev-parse HEAD); сайт $NEW_TARGET"

# Prune only direct, timestamp-named real directories. Never delete a path
# obtained from readlink. Keep the previous live release available for rollback.
mapfile -t RELEASE_NAMES < <(find releases -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
COUNT=0
for name in "${RELEASE_NAMES[@]}"; do
  valid_release_name "$name" || continue
  COUNT=$((COUNT + 1))
  if ((COUNT <= 5)) || [[ "$name" == "$OLD_NAME" || "$name" == "$NEW_NAME" ]]; then continue; fi
  candidate="$PROJECT_ROOT/releases/$name"
  [[ ! -L "$candidate" && "$(realpath -e -- "$candidate")" == "$candidate" ]] || continue
  rm -rf -- "$candidate"
done
REMOTE
echo '✅ Выпуск завершён; API и бот прошли проверку готовности.'
