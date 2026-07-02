# Cat's Pajamas Club — настройка бэкенда + Telegram-бота

Переход с localStorage на настоящий бэкенд: **Vercel (serverless) + Supabase (Postgres) + один Telegram-бот** (заявки, админ-панель, проверка подписки).

Архитектура:

```
            ┌──────────────────────┐        ┌─────────────┐
 Сайт  ───► │  API (Vercel /api/*) │ ◄────► │  Supabase    │
 (React)    │  общий слой логики   │        │  (Postgres)  │
            └──────────▲───────────┘        └─────────────┘
 Бот (Telegram) ───────┘   /api/bot — вебхук, тот же слой бронирования
```

---

## Что нужно сделать вам (одноразово)

### 1. Supabase
1. Зарегистрируйтесь на https://supabase.com → **New project** (регион ближе к РФ, напр. Frankfurt).
2. Дождитесь создания, откройте **SQL Editor** → вставьте и выполните `supabase/schema.sql` из этого репозитория.
3. **Project Settings → API** — скопируйте:
   - `Project URL` → `SUPABASE_URL`
   - `anon` `public` ключ → `SUPABASE_ANON_KEY`
   - `service_role` `secret` ключ → `SUPABASE_SERVICE_ROLE_KEY` (**секрет!**)

### 2. Telegram-бот
1. В Telegram напишите **@BotFather** → `/newbot` → имя и username (напр. `catspajamas_booking_bot`).
2. Скопируйте **токен** → `TELEGRAM_BOT_TOKEN` (**секрет!**), username → `TELEGRAM_BOT_USERNAME`.
3. Создайте/возьмите канал заведения, добавьте бота **администратором** канала (иначе проверка подписки не работает). Username канала → `TELEGRAM_CHANNEL`.
4. Свой числовой Telegram-ID узнайте у **@userinfobot** → впишите в `TELEGRAM_ADMIN_IDS` (через запятую можно несколько).

### 3. Переменные окружения в Vercel
**Project → Settings → Environment Variables** — добавьте все переменные из `.env.example`
(секреты `SUPABASE_SERVICE_ROLE_KEY` и `TELEGRAM_BOT_TOKEN` задавайте прямо здесь, не в коде).
Придумайте `TELEGRAM_WEBHOOK_SECRET` — любую длинную случайную строку.

### 4. Вебхук бота (после первого деплоя бэкенда)
Один раз выполнить (подставив токен, домен и секрет):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://cats-pajamas-club.vercel.app/api/bot&secret_token=<WEBHOOK_SECRET>"
```

---

## Что я делаю в коде (стадии)

| Стадия | Содержание | Блокер |
|---|---|---|
| ✅ 1 | Схема БД (`supabase/schema.sql`), `.env.example`, этот гайд | — |
| 2 | Серверный слой бронирования + API-роуты (`/api/reservations`, `/api/tables`, `/api/auth/*`) | нужен Supabase URL+ключи |
| 3 | Telegram-бот `/api/bot` (заявки, админ-панель, подписка) | нужен токен бота, канал, admin-ID |
| 4 | Рефактор фронта: `BookingService`/`AuthService` → async API | после стадии 2 |

После стадий заявки с **сайта** и из **бота** будут в одном списке, а админ видит и управляет всем — и в `/admin`, и в боте.

---

## Что передать мне, чтобы продолжить (несекретное можно в чат)

- `SUPABASE_URL` и `SUPABASE_ANON_KEY` (публичные — можно в чат)
- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_CHANNEL`, `TELEGRAM_ADMIN_IDS` (можно в чат)

**Секреты** (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) лучше **не присылать в чат** — задайте их сами в Vercel Environment Variables. Мой код читает их из `process.env`, сами значения мне видеть не нужно.
