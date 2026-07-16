-- ============================================================================
-- Cat's Pajamas Club — схема БД (Supabase / Postgres)
-- ============================================================================
-- Повторяет модель данных текущего localStorage-MVP, чтобы рефактор фронта
-- и бот работали с одной базой. Запускать в Supabase → SQL Editor.
--
-- Доступ только через серверный слой (Vercel serverless) с service_role ключом,
-- поэтому RLS включён и по умолчанию ничего не пускает (service_role его обходит).
-- ============================================================================

-- ─── Пользователи ───────────────────────────────────────────────────────────
create table if not exists public.users (
  id           text primary key,                  -- 'u_...' (сохраняем формат фронта)
  name         text        not null default '',
  phone        text                 default '',   -- нормализованный, только цифры
  telegram_id  text        unique,                -- String(tgUser.id) или null
  role         text        not null default 'guest'  -- 'guest' | 'admin'
                 check (role in ('guest','admin')),
  created_at   timestamptz not null default now()
);

create index if not exists users_phone_idx       on public.users (phone);
create index if not exists users_telegram_id_idx on public.users (telegram_id);

-- loyalty_points — история старой системы баллов (выведена 2026-07-04, колонка
-- остаётся, код её больше не читает). Уровень гостя теперь вычисляется из
-- числа подтверждённых броней (см. api/_lib/loyalty.js), в БД не хранится.
alter table public.users add column if not exists loyalty_points integer not null default 0;
-- true, если Telegram вернул 403 при рассылке (гость заблокировал бота) — такие
-- пропускаются в следующих рассылках, чтобы не долбить в закрытую дверь.
alter table public.users add column if not exists bot_blocked boolean not null default false;
-- @username из Telegram (без @, null если не задан) — обновляется ботом при
-- каждом контакте (ensureTelegramUser), показывается в админке «Гости».
alter table public.users add column if not exists telegram_username text;
-- Ручная правка уровня админом: null = уровень считается автоматически из
-- подтверждённых броней; 1..9 = выставлено вручную (побеждает большее из двух).
alter table public.users add column if not exists level_override integer;

-- ─── Брони ──────────────────────────────────────────────────────────────────
create table if not exists public.reservations (
  id                     text primary key,        -- 'r_...'
  table_id               text        not null,
  guest_id               text        references public.users (id) on delete set null,
  source                 text        not null default 'web'
                           check (source in ('web','telegram_bot','phone_manual')),
  status                 text        not null default 'confirmed'
                           check (status in ('pending','confirmed','cancelled','completed','no_show')),
  date                   date        not null,
  time_from              text        not null,     -- 'HH:MM'
  time_to                text        not null,     -- 'HH:MM'
  guests_count           integer     not null default 1,
  deposit_price          integer     not null default 0,
  deposit_status         text        not null default 'not_required',
  deposit_transaction_id text,
  created_by_admin_id    text,
  cancellation_reason    text,
  guest_name             text        not null default '',
  guest_phone            text                 default '',
  note                   text                 default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  cancelled_at           timestamptz
);

create index if not exists reservations_date_idx     on public.reservations (date);
create index if not exists reservations_table_idx    on public.reservations (table_id);
create index if not exists reservations_guest_idx    on public.reservations (guest_id);
create index if not exists reservations_status_idx   on public.reservations (status);
-- Быстрый поиск конфликтов по столу+дате
create index if not exists reservations_table_date_idx on public.reservations (table_id, date);

-- ─── Бронирование v2 («бронь по факту», см. HANDOFF_BOOKING_V2.md) ──────────
-- Новый статус 'seated' — гости за столом (автоматом в time_from или бармен
-- вручную «пришли»). CHECK пересоздаётся, т.к. таблица уже существует в бою.
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('pending','confirmed','seated','completed','no_show','cancelled'));

-- Правило одного вечера: конца брони в модели больше нет («по факту» =
-- неизвестно, когда стол освободится), поэтому один стол — максимум одна
-- активная бронь на дату. Последний рубеж против гонки двойного сабмита
-- (проверка в createReservation — классический TOCTOU) и заодно закрытие
-- документированной дыры старого индекса с пересекающимися интервалами.
-- ВНИМАНИЕ при накатке в бою: если в таблице уже есть две активные брони на
-- один стол+дату, создание индекса упадёт — сначала завершите/отмените дубли.
drop index if exists reservations_no_double_book_idx;
create unique index if not exists reservations_no_double_book_idx
  on public.reservations (table_id, date)
  where status in ('pending', 'confirmed', 'seated');

-- id сообщения-заявки в стафф-теме «Брони» — чтобы отредактировать его, когда
-- бронь отменяет гость или её чистит авто-протухание (кнопки подтверждения
-- в устаревшем сообщении не должны выглядеть живыми).
alter table public.reservations add column if not exists staff_message_id bigint;
-- Счётчик напоминаний персоналу о висящей pending-заявке (15 мин → 45 мин,
-- дальше не спамим) — состояние поллера в bot-start.js.
alter table public.reservations add column if not exists staff_reminder_count integer not null default 0;
-- message_id отправленных напоминаний «Заявка ждёт N минут» — чтобы удалить их
-- из темы «Брони», когда заявку подтвердили/отклонили/она протухла (иначе шум
-- копится поверх исходной карточки). См. clearStaffReminders в _lib/booking.js.
alter table public.reservations add column if not exists staff_reminder_msg_ids jsonb not null default '[]'::jsonb;

-- Walk-in занятость столов: бармен отмечает стол занятым/свободным без брони;
-- занятость по seated-брони тоже фиксируется здесь строкой source='reservation'
-- (НЕ фейковыми бронями). Открытая занятость = freed_at is null. План зала при
-- рендере мёржит: occupancy > confirmed-брони > vacant.
create table if not exists public.table_occupancy (
  id             text primary key,        -- 'occ_...'
  table_id       text        not null,
  source         text        not null default 'walk_in'
                   check (source in ('walk_in','reservation')),
  reservation_id text        references public.reservations (id) on delete set null,
  occupied_since timestamptz not null default now(),
  freed_at       timestamptz
);
-- Не больше одной открытой занятости на стол (двойной тап бармена, гонка
-- поллера и кнопки) — уровень БД, не только проверка в коде.
create unique index if not exists table_occupancy_open_idx
  on public.table_occupancy (table_id) where freed_at is null;
create index if not exists table_occupancy_table_idx on public.table_occupancy (table_id);

-- Метка «напоминание "Гость был?" уже отправлено» — колонка времён поллера
-- подтверждения явки (сам поллер удалён вместе с баллами 2026-07-04).
alter table public.reservations add column if not exists attendance_prompt_sent_at timestamptz;

-- ─── Конфиг столов и прочие настройки приложения ────────────────────────────
-- Зеркалит ключи localStorage (например 'table_config' = бывший cpjc_table_config:
-- per-table overrides, __custom[], __removed[]). Один jsonb на ключ — гибко.
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ─── OTP для входа по телефону (эфемерные коды) ─────────────────────────────
create table if not exists public.otps (
  phone      text primary key,
  code       text        not null,
  expires_at timestamptz not null
);

-- ─── Вход на сайте через Telegram-бота (эфемерные токены) ───────────────────
-- Сайт создаёт токен ('pending') → гость подтверждает в боте (подписка+телефон)
-- → бот ставит 'completed' + session_token → сайт один раз забирает и УДАЛЯЕТ
-- строку (одноразовое считывание, короткий TTL — этого достаточно для
-- портфолио-уровня безопасности). См. api/_lib/auth.js, api/bot.js.
create table if not exists public.web_login_tokens (
  token         text primary key,
  status        text not null default 'pending' check (status in ('pending','completed','expired')),
  telegram_id   text,
  session_token text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

-- ─── Меню (коктейли) ────────────────────────────────────────────────────────
-- Только на русском (решение владельца) — язык-переключатель сайта на это
-- содержимое не влияет. ingredients — короткий список через запятую (не полный
-- рецепт). image_url — просто ссылка (без Storage), может быть пустой.
create table if not exists public.cocktails (
  id           text primary key,        -- 'ck_...'
  name         text        not null,
  category     text        not null default 'classics'
                 check (category in ('classics','signature')),
  ingredients  text                 default '',
  story        text                 default '',   -- 2-3 предложения истории/легенды
  taste        text                 default '',   -- вкусовой профиль
  price        text        not null default '',
  image_url    text                 default '',
  sort_order   integer     not null default 0,
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cocktails_sort_idx on public.cocktails (sort_order);

-- ─── События ─────────────────────────────────────────────────────────────────
-- Реальная календарная дата (не день недели) — так «прошедшие» естественно
-- фильтруются запросом. Регулярную еженедельную программу админ пересоздаёт
-- на новую дату через кнопку «Повторить» в кабинете (без движка повторений).
create table if not exists public.events (
  id           text primary key,        -- 'ev_...'
  title        text        not null,
  event_date   date        not null,
  time         text        not null default '',   -- 'HH:MM'
  description  text                 default '',
  image_url    text                 default '',   -- если задан — фон карточки на сайте
  sort_order   integer     not null default 0,
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (event_date);

-- RSVP на события + начисление баллов по явке (см. api/_lib/eventRsvps.js).
-- Баллы за конкретное событие — опциональная настройка, не обязательная
-- (владелец включает при создании события, не для всех событий подряд).
alter table public.events add column if not exists awards_points boolean not null default false;
-- Та же метка-дедупликатор, что у reservations.attendance_prompt_sent_at —
-- не даёт поллеру слать список RSVP на подтверждение повторно.
alter table public.events add column if not exists attendance_prompt_sent_at timestamptz;

create table if not exists public.event_rsvps (
  id           text primary key,        -- 'rsvp_...'
  event_id     text        not null references public.events (id) on delete cascade,
  guest_id     text        references public.users (id) on delete set null,
  telegram_id  text        not null,
  status       text        not null default 'going' check (status in ('going','attended','no_show')),
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (event_id, guest_id)            -- повторное «Я приду» — идемпотентный upsert, не дубль
);
create index if not exists event_rsvps_event_idx  on public.event_rsvps (event_id);
create index if not exists event_rsvps_status_idx on public.event_rsvps (status);

-- ─── Отзывы ──────────────────────────────────────────────────────────────────
-- Ручной ввод администратором (решение владельца) — у Яндекс.Карт нет
-- публичного API для отзывов организации без спец-доступов; парсинг серый
-- и блокируется Яндексом. source='yandex' зарезервирован под будущую
-- официальную интеграцию, если она появится.
-- Публично показываются ТОЛЬКО active=true И rating>=4 (жёсткое правило,
-- не переключается админом) — так низкие оценки никогда не попадут на сайт.
create table if not exists public.reviews (
  id           text primary key,        -- 'rv_...'
  author       text        not null,
  rating       integer     not null default 5 check (rating between 1 and 5),
  text         text        not null default '',
  review_date  date        not null,
  source       text        not null default 'manual' check (source in ('manual','yandex')),
  active       boolean     not null default true,
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists reviews_date_idx on public.reviews (review_date);

-- «Полка воспоминаний» — отзывы приходят текстом из Telegram-обсуждения канала
-- (тема «Воспоминания», см. GUIDE_TELEGRAM_REVIEWS.md). telegram_message_id
-- уникален — защита от повторной доставки одного и того же вебхука Telegram.
-- telegram_id — для проверки антиспам-каденции (1 отзыв/30 дней на гостя).
alter table public.reviews add column if not exists telegram_message_id text unique;
alter table public.reviews add column if not exists telegram_id text;
create index if not exists reviews_telegram_id_idx on public.reviews (telegram_id);

alter table public.reviews drop constraint if exists reviews_source_check;
alter table public.reviews add constraint reviews_source_check
  check (source in ('manual','yandex','telegram_group'));

-- ─── Команда ─────────────────────────────────────────────────────────────────
create table if not exists public.team_members (
  id           text primary key,        -- 'tm_...'
  name         text        not null,
  role         text                 default '',
  spec         text                 default '',
  quote        text                 default '',   -- показывается в кавычках, шрифт Jar Binks
  photo_url    text                 default '',
  sort_order   integer     not null default 0,
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists team_members_sort_idx on public.team_members (sort_order);

-- Секция «Бармены» v2 (2026-07-05): биография + книжная цитата с указанием
-- источника (quote теперь книжная цитата о философии бара, quote_source —
-- «Автор, „Книга“»; персональные цитаты барменов выведены по макету владельца).
alter table public.team_members add column if not exists bio text default '';
alter table public.team_members add column if not exists quote_source text default '';

-- ─── Заявки «стать барменом» ─────────────────────────────────────────────────
-- Сохраняются в БД И пушатся в Telegram админам (TELEGRAM_ADMIN_IDS) — best-effort,
-- сбой отправки не блокирует сохранение самой заявки.
create table if not exists public.team_applications (
  id           text primary key,        -- 'ap_...'
  name         text        not null,
  phone        text        not null default '',
  experience   text                 default '',
  status       text        not null default 'new' check (status in ('new','reviewed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists team_applications_created_idx on public.team_applications (created_at);

-- ─── ⚠️ ВЫВЕДЕНО ИЗ ПРОДУКТА 2026-07-04: колесо дня и баллы ─────────────────
-- Таблицы wheel_spins / loyalty_transactions / loyalty_rewards /
-- loyalty_redemptions и функция redeem_loyalty_reward остаются в схеме только
-- как история прода — код к ним больше не обращается. Уровень гостя теперь
-- вычисляется из подтверждённых броней (api/_lib/loyalty.js).
create table if not exists public.wheel_spins (
  id           text primary key,        -- 'ws_...'
  guest_id     text        not null references public.users (id) on delete cascade,
  spin_date    date        not null,
  prize_code   text        not null,
  prize_label  text        not null,
  redeemed     boolean     not null default false,
  created_at   timestamptz not null default now(),
  unique (guest_id, spin_date)
);
create index if not exists wheel_spins_guest_idx    on public.wheel_spins (guest_id);
create index if not exists wheel_spins_date_idx     on public.wheel_spins (spin_date);
create index if not exists wheel_spins_redeemed_idx on public.wheel_spins (redeemed);

-- ─── Каталог наград лояльности (прямое списание баллов) ─────────────────────
-- Полная история начислений/списаний — единый журнал для визитов, колеса и
-- обменов на награды (source_type различает источник; source_id — id брони/
-- события/спина/погашения, откуда пришло изменение, если применимо).
create table if not exists public.loyalty_transactions (
  id            text primary key,        -- 'lt_...'
  user_id       text        not null references public.users (id) on delete cascade,
  delta         integer     not null,     -- + начисление, - списание
  reason        text        not null default '',
  source_type   text        not null check (source_type in ('visit','wheel','redemption','manual')),
  source_id     text,
  balance_after integer     not null,
  created_at    timestamptz not null default now()
);
create index if not exists loyalty_transactions_user_idx on public.loyalty_transactions (user_id, created_at);

-- tier_required — ключ из TIERS в api/_lib/loyalty.js (kitten/jazzcat/oldpaw/boss),
-- держать в синхроне вручную с check ниже, как и остальные enum-подобные колонки
-- в этой схеме (нет отдельной таблицы уровней — TIERS только в коде).
create table if not exists public.loyalty_rewards (
  id                text primary key,        -- 'lr_...'
  title             text        not null,
  description       text                 default '',
  cost_points       integer     not null,
  tier_required     text                 check (tier_required is null or tier_required in ('kitten','jazzcat','oldpaw','boss')),
  active            boolean     not null default true,
  expires_after_days integer,
  created_at        timestamptz not null default now()
);

-- code — короткий 6-символьный uppercase alphanumeric, показывается гостю
-- (текстом + QR) и вводится/сканируется барменом для погашения.
create table if not exists public.loyalty_redemptions (
  id                   text primary key,        -- 'lrd_...'
  code                 text        not null unique,
  user_id              text        not null references public.users (id) on delete cascade,
  reward_id            text        not null references public.loyalty_rewards (id) on delete restrict,
  points_spent         integer     not null,
  status               text        not null default 'issued' check (status in ('issued','redeemed','expired')),
  created_at           timestamptz not null default now(),
  redeemed_at          timestamptz,
  redeemed_by_admin_id bigint
);
create unique index if not exists loyalty_redemptions_code_idx on public.loyalty_redemptions (code);
create index if not exists loyalty_redemptions_user_idx   on public.loyalty_redemptions (user_id);
create index if not exists loyalty_redemptions_status_idx on public.loyalty_redemptions (status);

-- Атомарное списание баллов + создание погашения + запись в журнал — одной
-- функцией, чтобы все три изменения были всё-или-ничего (supabase-js не даёт
-- клиентских транзакций через несколько отдельных вызовов). WHERE-условие в
-- UPDATE атомарно на уровне Postgres: если баллов уже не хватает (списали
-- параллельно вторым кликом), RETURNING отдаст NULL и функция бросит
-- исключение — вставки ниже не выполнятся, откатится вся функция целиком.
create or replace function public.redeem_loyalty_reward(
  p_user_id text, p_reward_id text, p_cost integer,
  p_redemption_id text, p_code text, p_reason text
)
returns integer
language plpgsql as $$
declare
  v_new_balance integer;
begin
  update public.users
    set loyalty_points = loyalty_points - p_cost
    where id = p_user_id and loyalty_points >= p_cost
    returning loyalty_points into v_new_balance;

  if v_new_balance is null then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into public.loyalty_redemptions (id, code, user_id, reward_id, points_spent, status)
  values (p_redemption_id, p_code, p_user_id, p_reward_id, p_cost, 'issued');

  insert into public.loyalty_transactions (id, user_id, delta, reason, source_type, source_id, balance_after)
  values (p_redemption_id || '_tx', p_user_id, -p_cost, p_reason, 'redemption', p_redemption_id, v_new_balance);

  return v_new_balance;
end;
$$;

-- ─── RLS: всё закрыто, серверный service_role обходит политики ───────────────
alter table public.users             enable row level security;
alter table public.reservations      enable row level security;
alter table public.app_config        enable row level security;
alter table public.otps              enable row level security;
alter table public.web_login_tokens  enable row level security;
alter table public.cocktails         enable row level security;
alter table public.events            enable row level security;
alter table public.reviews           enable row level security;
alter table public.team_members      enable row level security;
alter table public.team_applications enable row level security;
alter table public.wheel_spins        enable row level security;
alter table public.event_rsvps        enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.loyalty_rewards      enable row level security;
alter table public.loyalty_redemptions  enable row level security;
alter table public.table_occupancy      enable row level security;
-- Намеренно без policy: анонимный клиент ничего не видит, всё ходит через сервер.

-- ─── Автообновление updated_at ──────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reservations_touch on public.reservations;
create trigger reservations_touch
  before update on public.reservations
  for each row execute function public.touch_updated_at();

drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch
  before update on public.app_config
  for each row execute function public.touch_updated_at();

drop trigger if exists cocktails_touch on public.cocktails;
create trigger cocktails_touch
  before update on public.cocktails
  for each row execute function public.touch_updated_at();

drop trigger if exists events_touch on public.events;
create trigger events_touch
  before update on public.events
  for each row execute function public.touch_updated_at();

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch
  before update on public.reviews
  for each row execute function public.touch_updated_at();

drop trigger if exists team_members_touch on public.team_members;
create trigger team_members_touch
  before update on public.team_members
  for each row execute function public.touch_updated_at();

drop trigger if exists team_applications_touch on public.team_applications;
create trigger team_applications_touch
  before update on public.team_applications
  for each row execute function public.touch_updated_at();
