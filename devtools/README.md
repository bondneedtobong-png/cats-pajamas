# devtools — локальная песочница для тестов без прод-БД

Прод-БД (self-hosted Supabase на VPS) руками не потрогать. Эти инструменты
поднимают **реальный код проекта** (`server.js`, `api/*.js`, `api/bot.js`) поверх
**мок-PostgREST в памяти**, чтобы тестировать CRUD и бот-флоу локально.

| Файл | Что |
|---|---|
| `pgrest-mock.mjs` | мини-PostgREST в памяти (select/insert/upsert/update/delete, фильтры, unique-индексы→23505, rpc). Самодостаточен. |
| `sandbox.mjs` | реальный Express-`server.js` поверх мока + сидовые юзеры; печатает admin/guest сессионные токены |
| `bot_e2e.mjs` | реальный `buildBot()`+`handleUpdate()` против мока, перехват `api.telegram.org`; 50 проверок бот-сценариев |

## Запуск (из корня `cats-pajamas-club/`)

```bash
# 1) API-песочница (порт 3001, БД в памяти)
node devtools/sandbox.mjs
#    → в stdout admin/guest токены. Дёргай curl'ом:
#    curl -H "Authorization: Bearer <admin token>" http://127.0.0.1:3001/api/cocktails?admin=1

# 2) Фронт против песочницы
echo 'VITE_API_BASE=http://127.0.0.1:3001' > .env.development.local
npm run dev            # удали .env.development.local, чтобы вернуть прод-API

# 3) Бот-сценарии
node devtools/bot_e2e.mjs   # ждём "ALL SCENARIOS PASS"
```

## Тестируешь новый CRUD-ресурс

1. Если у таблицы есть unique-индексы или дефолтные поля — добавь их в `UNIQUE` /
   `DEFAULTS` в `pgrest-mock.mjs` (иначе гонки/дефолты не смоделируются).
2. Сидируй тестовые строки в `createDb({...})` в `sandbox.mjs`.
3. Логинься в preview как admin: `localStorage.setItem('cpjc_token', <admin токен>)`
   + `cpjc_user` с `role:'admin'`, открой `/admin`.

Мок покрывает то, что реально использует проект, — не полноценный Postgres.
Если фича упирается в неподдержанный SQL, расширь `pgrest-mock.mjs` точечно.
