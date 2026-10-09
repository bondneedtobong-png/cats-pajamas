import crypto from 'node:crypto';
import { supabase } from './supabase.js';
import { issueToken, verifyToken, rowToUser } from './session.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;

function genOtp() { return String(crypto.randomInt(1000, 10000)); }
function genId() { return 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
// This mock is only a local UI sandbox, never an SMS authentication provider.
// Require both server opt-in and local site/database; unset NODE_ENV is closed.
export function isDemoOtpEnabled() {
  return ['development', 'test'].includes(process.env.NODE_ENV)
    && process.env.AUTH_DEMO_OTP === 'true'
    && isLocalUrl(process.env.PUBLIC_SITE_URL)
    && isLocalUrl(process.env.SUPABASE_URL);
}
function denyDemoOtp() {
  const error = new Error('Вход по телефону недоступен. Войдите через Telegram.');
  error.status = 403;
  return error;
}
async function demoPhoneUsers(phone) {
  if (!isDemoOtpEnabled()) throw denyDemoOtp();
  const { data, error } = await supabase.from('users').select('*').eq('phone', phone);
  if (error) throw new Error('Не удалось проверить локальный аккаунт');
  // Never map public mock proof to Telegram identities (owner/staff may have
  // role=guest), privileged roles, or merge those identities into a demo user.
  if (data?.some(user => user.role !== 'guest' || user.telegram_id)) throw denyDemoOtp();
  return data || [];
}

// Единая форма номера — иначе один человек = несколько аккаунтов: гость вводит
// «8 927…» на сайте (OTP) и делится «+7 927…» в боте, раньше это были разные
// строки (89277418514 ≠ 79277418514) и разные users. Приводим российские
// номера к каноничному 7XXXXXXXXXX: ведущая 8 при 11 цифрах → 7; голые 10 цифр
// (без кода страны) → +7. Иностранные номера (например 1-407… у гостя из США)
// не трогаем — у них своя длина/код.
function normalizePhone(p) {
  let d = (p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  return d;
}

// Слияние дублей одного гостя по нормализованному телефону: все аккаунты с тем
// же номером (кроме keepUserId) вливаются в keepUserId — их брони и связанные
// записи переезжают, сами строки удаляются. keepUserId должен быть «богаче»
// (обычно с telegram_id — чтобы ходили ЛС-уведомления по броням). Это лечит и
// уже возникшие дубли (гость делится номером в боте → его прежний phone-only
// аккаунт с сайта вливается), и предотвращает новые.
async function mergeUsersByPhone(keepUserId, normalizedPhone) {
  if (!keepUserId || !normalizedPhone) return;
  const { data: dups } = await supabase.from('users')
    .select('id').eq('phone', normalizedPhone).neq('id', keepUserId);
  if (!dups?.length) return;
  for (const dup of dups) {
    // Брони — критично. FK reservations.guest_id = ON DELETE SET NULL: если
    // удалить дубль, не перенеся его брони, подтверждённая бронь осиротеет
    // (guest_id → null: пропадёт из кабинета, у бармена не резолвится гость,
    // ЛС-уведомления не уходят). supabase-js НЕ бросает на ошибке БД — вернёт
    // {error} и зарезолвится, поэтому проверяем error ЯВНО и не удаляем аккаунт
    // при сбое переноса. Плюс финальная страховка ниже: перечитываем, что за
    // дублем не осталось ни одной брони, — только тогда удаляем.
    const { error: resvErr } = await supabase.from('reservations')
      .update({ guest_id: keepUserId }).eq('guest_id', dup.id);
    if (resvErr) {
      console.error('[auth] merge: reservations move failed, keep dup', dup.id, resvErr.message);
      continue;
    }
    // Остальные связи best-effort: у phone-only дубля их обычно нет, а unique-
    // индексы (event_id+guest_id, guest_id+spin_date) при коллизии просто
    // оставят строку у дубля. reviews не переносим: там нет guest_id, привязка
    // по telegram_id (остаётся на аккаунте-победителе — у него telegram_id и есть).
    for (const [table, col] of [
      ['event_rsvps', 'guest_id'],
      ['wheel_spins', 'guest_id'],
      ['loyalty_transactions', 'user_id'],
      ['loyalty_redemptions', 'user_id'],
    ]) {
      await supabase.from(table).update({ [col]: keepUserId }).eq(col, dup.id).catch(() => {});
    }
    // Страховка перед необратимым удалением: убеждаемся, что ни одна бронь
    // больше не ссылается на дубль (перенос выше мог частично не пройти).
    const { data: left, error: leftErr } = await supabase.from('reservations')
      .select('id').eq('guest_id', dup.id).limit(1);
    if (leftErr || left?.length) {
      console.error('[auth] merge: reservations still on dup, keep it', dup.id);
      continue;
    }
    await supabase.from('users').delete().eq('id', dup.id).catch(() => {});
  }
}

export async function requestOtp(phone) {
  if (!isDemoOtpEnabled()) throw denyDemoOtp();
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) throw new Error('Введите корректный номер телефона');
  await demoPhoneUsers(normalized);
  const code = genOtp();
  const { error } = await supabase.from('otps').upsert({
    phone: normalized, code, expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });
  if (error) throw new Error('Не удалось создать локальный демо-код');
  return { devCode: code };
}

export async function verifyOtp(phone, code) {
  if (!isDemoOtpEnabled()) throw denyDemoOtp();
  const normalized = normalizePhone(phone);
  const matches = await demoPhoneUsers(normalized);
  const { data: otp } = await supabase.from('otps').select('*').eq('phone', normalized).maybeSingle();
  if (!otp) throw new Error('Запросите код повторно');
  if (!Number.isFinite(Date.parse(otp.expires_at)) || Date.parse(otp.expires_at) <= Date.now()) throw new Error('Код истёк, запросите новый');
  if (otp.code !== String(code).trim()) throw new Error('Неверный код');
  const { data: consumed, error: consumeError } = await supabase.from('otps').delete()
    .eq('phone', normalized).eq('code', otp.code).eq('expires_at', otp.expires_at)
    .gt('expires_at', new Date(Date.now()).toISOString()).select('phone');
  if (consumeError) throw new Error('Не удалось проверить локальный демо-код');
  if (!consumed?.length) throw new Error('Запросите код повторно');
  let existing = matches[0] || null;
  if (!existing) {
    const row = {
      id: genId(), name: '', phone: normalized, telegram_id: null,
      role: 'guest', created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('users').insert(row).select().single();
    if (error) throw new Error(error.message);
    existing = data;
  }
  const user = rowToUser(existing);
  return { user, token: issueToken(user.id) };
}

const ADMIN_TG_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * Find or create a user by Telegram id. Used by the bot, which has already
 * verified channel subscription, so no gating here. Admins (TELEGRAM_ADMIN_IDS)
 * get role='admin'.
 */
export async function ensureTelegramUser(tgUser) {
  const tgId = String(tgUser.id);
  const role = ADMIN_TG_IDS.includes(tgId) ? 'admin' : 'guest';
  const username = tgUser.username || null;
  let { data: existing } = await supabase.from('users')
    .select('*').eq('telegram_id', tgId).maybeSingle();
  if (!existing) {
    const row = {
      id: genId(), name: tgUser.first_name || '', phone: '',
      telegram_id: tgId, telegram_username: username,
      role, created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('users').insert(row).select().single();
    if (error) throw new Error(error.message);
    existing = data;
  } else {
    // Поддерживаем актуальность: повышение до admin (если id добавили в env)
    // и смена @username гостем — он показывается в админке «Гости».
    const patch = {};
    if (role === 'admin' && existing.role !== 'admin') patch.role = role;
    if ((existing.telegram_username || null) !== username) patch.telegram_username = username;
    if (Object.keys(patch).length) {
      const { data } = await supabase.from('users').update(patch).eq('id', existing.id).select().single();
      existing = data || existing;
    }
  }
  return rowToUser(existing);
}

export function isTelegramAdmin(tgId) {
  return ADMIN_TG_IDS.includes(String(tgId));
}

const STAFF_TG_IDS = (process.env.TELEGRAM_STAFF_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

// Персонал из env имеет служебные права бота; роль веб-админки задаётся
// отдельно. Администраторы неявно тоже персонал.
export function isTelegramStaff(tgId) {
  return STAFF_TG_IDS.includes(String(tgId)) || isTelegramAdmin(tgId);
}

export async function updateProfile(userId, updates) {
  const patch = {};
  if (typeof updates.name === 'string') patch.name = updates.name; // whitelist
  const { data, error } = await supabase.from('users').update(patch).eq('id', userId).select().single();
  if (error) throw new Error('Пользователь не найден');
  return rowToUser(data);
}

export async function setUserPhone(userId, phone) {
  const normalized = normalizePhone(phone);
  const { data, error } = await supabase.from('users').update({ phone: normalized }).eq('id', userId).select().single();
  if (error) throw new Error('Не удалось сохранить номер телефона');
  // Гость поделился номером (бот request_contact) — вливаем в этот аккаунт его
  // прежние дубли с тем же номером (phone-only с сайта и т.п.), чтобы «один
  // человек = один аккаунт». Best-effort: сбой слияния не должен ронять сам
  // вход/сохранение номера.
  await mergeUsersByPhone(userId, normalized).catch((e) => console.error('[auth] merge failed:', e.message));
  return rowToUser(data);
}

// ─── Вход на сайте через Telegram-бота (см. HANDOFF_BOT_AGENT.md) ────────────
// Сайт создаёт токен → гость подтверждает в боте (подписка уже проверена там,
// плюс телефон через request_contact) → бот завершает токен → сайт забирает
// сессию поллингом. Реальная проверка подписки живёт в api/bot.js, здесь её
// не дублируем — этот файл просто хранит состояние флоу.

function genLoginToken() { return crypto.randomBytes(24).toString('hex'); }

export async function createLoginToken() {
  const token = genLoginToken();
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString();
  const { error } = await supabase.from('web_login_tokens')
    .insert({ token, status: 'pending', expires_at: expiresAt });
  if (error) throw new Error(error.message);
  return { token, expiresAt };
}

/** Вызывается ботом после подписки+телефона — переводит токен в 'completed'. */
export async function completeLoginToken(loginToken, tgUser, phone) {
  const { data: row } = await supabase.from('web_login_tokens').select('*').eq('token', loginToken).maybeSingle();
  if (!row) throw new Error('Ссылка для входа не найдена, попробуйте войти на сайте заново');
  if (row.status !== 'pending') throw new Error('Эта ссылка для входа уже использована');
  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) throw new Error('Ссылка для входа истекла, попробуйте войти на сайте заново');

  const user = await ensureTelegramUser(tgUser);
  if (!user.phone && phone) await setUserPhone(user.id, phone);
  const sessionToken = issueToken(user.id);
  const { data: completed, error } = await supabase.from('web_login_tokens')
    .update({ status: 'completed', telegram_id: String(tgUser.id), session_token: sessionToken })
    .eq('token', loginToken).eq('status', 'pending')
    .gt('expires_at', new Date(Date.now()).toISOString()).select('token');
  if (error) throw new Error('Не удалось завершить вход через Telegram');
  if (!completed?.length) throw new Error('Ссылка для входа истекла или уже использована');
  return user;
}

/** Вызывается сайтом-поллингом. При status='completed' — одноразово забирает
 *  сессию и удаляет строку, чтобы токен нельзя было перехватить и переиспользовать. */
export async function checkLoginToken(token) {
  const { data: row } = await supabase.from('web_login_tokens').select('*').eq('token', token).maybeSingle();
  if (!row) return { status: 'not_found' };

  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) {
    await supabase.from('web_login_tokens').delete().eq('token', token).eq('expires_at', row.expires_at);
    return { status: 'expired' };
  }
  if (row.status !== 'completed') return { status: row.status };
  // DELETE ... RETURNING is the atomic claim: concurrent pollers can select
  // the same row but only one receives it from this mutation.
  const { data: claimed, error } = await supabase.from('web_login_tokens').delete()
    .eq('token', token).eq('status', 'completed')
    .gt('expires_at', new Date(Date.now()).toISOString()).select('*');
  if (error) throw new Error('Не удалось проверить вход через Telegram');
  if (!claimed?.length) return { status: 'not_found' };
  const sessionToken = claimed[0].session_token;
  const userId = verifyToken(sessionToken);
  const { data: userRow } = userId
    ? await supabase.from('users').select('*').eq('id', userId).maybeSingle()
    : { data: null };
  if (!userRow) return { status: 'expired' };
  return { status: 'completed', token: sessionToken, user: rowToUser(userRow) };
}

// ─── Telegram Mini App (WebApp) — вход для /booking, открытого внутри бота ───
// Спецификация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// initData подписан ботом при каждом открытии Mini App — проверяем подпись
// сами, без похода в Supabase, дальше переиспользуем ensureTelegramUser (тот же
// путь, что и бот, и веб-логин — единая точка присвоения role='admin').
const INIT_DATA_MAX_AGE_S = 24 * 60 * 60; // 24 часа — с запасом, initData всё равно перевыпускается при каждом открытии

export function verifyTelegramWebAppInitData(initData) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!token) throw new Error('Бот не настроен на сервере');
  if (!initData || typeof initData !== 'string') throw new Error('Нет данных от Telegram');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Некорректные данные Telegram');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Проверка подписи Telegram не пройдена');
  }

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_S) {
    throw new Error('Данные от Telegram устарели — закройте и откройте Mini App заново');
  }

  const userJson = params.get('user');
  if (!userJson) throw new Error('Нет данных пользователя от Telegram');
  return JSON.parse(userJson);
}

export async function authViaTelegramWebApp(initData) {
  const tgUser = verifyTelegramWebAppInitData(initData);
  const user = await ensureTelegramUser(tgUser);
  return { user, token: issueToken(user.id) };
}
