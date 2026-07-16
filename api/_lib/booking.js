import { supabase } from './supabase.js';
import { TABLES, activeSeats } from '../../src/booking/tablesConfig.js';
import { BOOKING_RULES } from '../../src/booking/bookingRules.js';
import {
  timeToMin, minToTime, reservationInstant, barEveningDate,
} from '../../src/booking/barTime.js';
import { notifyStaff, notifyStaffPhoto, editStaffMessage, deleteStaffMessage } from './staffNotify.js';
import { notifyGuestTg } from './telegramNotify.js';
import { renderPlanPng } from './planImage.js';

export { timeToMin, minToTime };

const SRC_LABEL = { web: 'сайт', telegram_bot: 'Telegram', phone_manual: 'звонок' };

// Бронирование v2 (HANDOFF_BOOKING_V2.md): бронь «по факту» — гость выбирает
// только время прихода, стол занят до реального ухода гостей (освобождает
// бармен). Каждую гостевую заявку подтверждает бармен: pending → confirmed →
// seated → completed (баллы) / no_show; cancelled — отмена/отклонение.
// Логика общая для сайта, бота и админки — не дублировать в каналах.

// v2: ключ поднят вместе с новым планом зала — старые оверрайды позиций из
// админ-редактора (app_config['table_config']) сняты под координаты старого
// плана и к плану v2 неприменимы. Депозиты и так везде 0.
const TABLE_CONFIG_KEY = 'table_config_v2';

export const ACTIVE_STATUSES = ['pending', 'confirmed', 'seated'];
const FINAL_STATUSES = ['cancelled', 'completed', 'no_show'];

// Гостевая заявка без ответа бармена 6 часов — чистим как мусор. Это НЕ
// «авто-отмена вместо бармена» (та запрещена владельцем), а уборка заявок,
// которые уже никому не нужны. Второй случай — время прихода давно прошло
// (грейс 45 мин: гость мог прийти «на сейчас», бармен ещё успевает подтвердить).
const PENDING_CONFIRM_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const PENDING_PAST_ARRIVAL_GRACE_MS = 45 * 60 * 1000;

// Бронь «на сейчас» разрешаем задним числом до 30 минут — гость уже в пути.
const PAST_ARRIVAL_GRACE_MS = 30 * 60 * 1000;

// В форме нет time_to (бронь по факту), но колонка живёт: история и старый
// бот-флоу её читают/пишут. Для новых броней пишем условные +3 часа.
const LEGACY_TIME_TO_MIN = 180;

const STAFF_BOOKINGS_THREAD = () => process.env.TELEGRAM_STAFF_BOOKINGS_THREAD_ID;

function generateId(prefix = 'r') { return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

// Пользовательский ввод внутри Markdown-сообщений: незакрытый '_' или '*' в
// имени гостя валит parse у Telegram, и уведомление молча не доходит.
function mdEscape(s) { return String(s || '').replace(/([_*[\]`])/g, '\\$1'); }

function fmtDateRu(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// ─── row <-> reservation mapping ─────────────────────────────────────────────
function rowToRes(r) {
  return {
    id: r.id,
    tableId: r.table_id,
    guestId: r.guest_id,
    source: r.source,
    status: r.status,
    date: r.date,
    timeFrom: r.time_from,
    timeTo: r.time_to,
    guestsCount: r.guests_count,
    depositPrice: r.deposit_price,
    depositStatus: r.deposit_status,
    depositTransactionId: r.deposit_transaction_id || null,
    createdByAdminId: r.created_by_admin_id || null,
    cancellationReason: r.cancellation_reason || null,
    guestName: r.guest_name || '',
    guestPhone: r.guest_phone || '',
    note: r.note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: r.cancelled_at || null,
    attendancePromptSentAt: r.attendance_prompt_sent_at || null,
    staffMessageId: r.staff_message_id || null,
    staffReminderCount: r.staff_reminder_count || 0,
    staffReminderMsgIds: Array.isArray(r.staff_reminder_msg_ids) ? r.staff_reminder_msg_ids : [],
  };
}

// Уборка сообщений-напоминаний «Заявка ждёт N минут» после того, как заявка
// ушла из pending (подтверждена/отклонена/протухла): в теме «Брони» остаётся
// только исходная карточка заявки с итогом, без накопившегося шума.
// ВАЖНО про гонку с поллером: id перечитываем из БД прямо здесь, а не берём из
// снапшота вызывающего — поллер (remindStalePendingBookings, отдельный процесс)
// мог дописать новое напоминание между чтением у вызывающего и этим моментом;
// свежее чтение гарантирует, что удалим и его. Принимает id (строку) или объект
// с .id. Best-effort: сбой удаления (сообщение старше 48ч и т.п.) не важен.
async function clearStaffReminders(idOrRow) {
  const id = typeof idOrRow === 'string' ? idOrRow : idOrRow?.id;
  if (!id) return;
  const { data } = await supabase.from('reservations')
    .select('staff_reminder_msg_ids').eq('id', id).maybeSingle();
  const ids = Array.isArray(data?.staff_reminder_msg_ids) ? data.staff_reminder_msg_ids : [];
  if (ids.length) await Promise.all(ids.map(mid => deleteStaffMessage(mid).catch(() => {})));
  await supabase.from('reservations')
    .update({ staff_reminder_msg_ids: [] }).eq('id', id).catch(() => {});
}

// ─── table config (jsonb blob in app_config) ─────────────────────────────────
async function loadTableConfig() {
  const { data, error } = await supabase
    .from('app_config').select('value').eq('key', TABLE_CONFIG_KEY).maybeSingle();
  if (error || !data) return {};
  return data.value || {};
}
async function saveTableConfig(cfg) {
  await supabase.from('app_config').upsert({ key: TABLE_CONFIG_KEY, value: cfg });
}

// План статичен (v2): позиции столов живут только в tablesConfig.js.
// Оверрайды из админки — депозит и число мест (seatsCount задаётся числом,
// 2026-07-04; старые пер-местные seats-оверрайды читаются для совместимости).
export async function getTablesMerged() {
  const cfg = await loadTableConfig();
  return TABLES.map(t => {
    const ov = cfg[t.id] || {};
    return {
      ...t,
      depositPrice: ov.depositPrice ?? t.depositPrice ?? 0,
      seatsCount: Number.isFinite(ov.seatsCount) && ov.seatsCount > 0 ? ov.seatsCount : null,
      seats: t.seats.map((s, i) => ({ ...s, active: ov.seats?.[i]?.active ?? s.active })),
    };
  });
}

// ─── блокировка дат бронирования (app_config: booking_dates) ─────────────────
// blockedDates — конкретные даты (ISO). blockToday/blockTomorrow — блокировка
// ОТНОСИТЕЛЬНЫХ кнопок «Сегодня»/«Завтра»: флаг живёт, пока владелец его не
// снимет, и каждый день блокирует новую «сегодняшнюю» дату (просьба владельца).
const BOOKING_DATES_KEY = 'booking_dates';

export async function getBookingDatesConfig() {
  const { data } = await supabase.from('app_config').select('value').eq('key', BOOKING_DATES_KEY).maybeSingle();
  const v = data?.value || {};
  return {
    blockToday: !!v.blockToday,
    blockTomorrow: !!v.blockTomorrow,
    blockedDates: Array.isArray(v.blockedDates) ? v.blockedDates : [],
  };
}

export async function setBookingDatesConfig(patch) {
  const cur = await getBookingDatesConfig();
  const next = { ...cur, ...patch };
  next.blockedDates = [...new Set(next.blockedDates)]
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  await supabase.from('app_config').upsert({ key: BOOKING_DATES_KEY, value: next });
  return next;
}

function tomorrowEveningDate() {
  const today = barEveningDate();
  return new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
}

/** Бросает, если владелец закрыл эту дату для брони. Сервер — последний рубеж:
 *  виджет прячет закрытые даты, но проверка обязана жить и здесь. */
export async function assertDateBookable(date) {
  const cfg = await getBookingDatesConfig();
  if (cfg.blockedDates.includes(date)) {
    throw new Error('На эту дату брони не принимаются — выберите другой день');
  }
  if (cfg.blockToday && date === barEveningDate()) {
    throw new Error('Сегодня брони не принимаются — выберите другой день');
  }
  if (cfg.blockTomorrow && date === tomorrowEveningDate()) {
    throw new Error('На завтра брони не принимаются — выберите другой день');
  }
}

// ─── подписи столов ──────────────────────────────────────────────────────────
// Нумерация ЗОННАЯ (решение владельца): «Основной зал, стол №2», «У окна,
// стол №3», «Диван №1». Внутренние id (T1/B1) гостю и бармену не показываются.
function tableStaffLabel(table, tableId) {
  if (!table) return `Стол ${tableId}`;
  return table.type === 'booth'
    ? `Диван №${table.num}`
    : `${table.zone}, стол №${table.num}`;
}

function seatsWord(n) {
  const d10 = n % 10, d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return 'место';
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'места';
  return 'мест';
}

/** Человеческое описание стола для гостя: «Основной зал, стол №2 · 4 места». */
export function tableGuestLabel(table) {
  if (!table) return 'Стол';
  const seats = activeSeats(table);
  return `${tableStaffLabel(table)} · ${seats} ${seatsWord(seats)}`;
}

/** Текст заявки в стафф-тему «Брони» — единый билдер, чтобы правки сообщения
 *  (отмена гостем, протухание, подтверждение) пересобирали тот же текст. */
export function staffBookingText(r, table) {
  const lines = [
    '🪑 *Заявка на бронь*',
    '',
    tableStaffLabel(table, r.tableId),
    `📅 ${fmtDateRu(r.date)} · приход к ${r.timeFrom}`,
    `👥 ${r.guestsCount} ${r.guestsCount === 1 ? 'гость' : 'гостей'}`,
    `👤 ${mdEscape(r.guestName)}${r.guestPhone ? ' · ' + mdEscape(r.guestPhone) : ''}`,
  ];
  if (r.note) lines.push(`💬 ${mdEscape(r.note)}`);
  if (r.depositPrice > 0) {
    lines.push(`💰 Депозит: ${r.depositPrice} ₽${r.depositStatus === 'paid_mock' ? ' · оплачен' : ''}`);
  }
  lines.push(`Источник: ${SRC_LABEL[r.source] || r.source}`);
  return lines.join('\n');
}

export function staffConfirmKeyboard(reservationId) {
  return { inline_keyboard: [[
    { text: '✅ Подтвердить', callback_data: `stok:${reservationId}` },
    { text: '❌ Отклонить', callback_data: `stno:${reservationId}` },
  ]] };
}

async function sendStaffBookingRequest(res, table) {
  const opts = {
    threadId: STAFF_BOOKINGS_THREAD(),
    replyMarkup: staffConfirmKeyboard(res.id),
  };
  // Заявка уходит картинкой плана с выделенным столом; если рендер или
  // отправка фото не удались — фолбэк на обычный текст, заявка важнее красоты.
  let messageId = null;
  try {
    const png = await renderPlanPng(res.tableId);
    messageId = await notifyStaffPhoto(png, staffBookingText(res, table), opts);
  } catch (e) {
    console.error('[booking] plan image failed:', e.message);
  }
  if (!messageId) messageId = await notifyStaff(staffBookingText(res, table), opts);
  if (messageId) {
    await supabase.from('reservations').update({ staff_message_id: messageId }).eq('id', res.id);
  }
}

// Правка стафф-сообщения, когда заявка умерла не от кнопки в нём самом
// (отмена гостем, авто-протухание) — снимаем кнопки, дописываем итог.
function editStaffBookingMessage(r, table, suffix) {
  if (!r.staffMessageId) return Promise.resolve();
  return editStaffMessage(r.staffMessageId, staffBookingText(r, table) + '\n\n' + suffix);
}

export async function getGuestTelegramId(guestId) {
  if (!guestId) return null;
  const { data } = await supabase.from('users').select('telegram_id').eq('id', guestId).maybeSingle();
  return data?.telegram_id || null;
}

export async function getReservationById(id) {
  const { data, error } = await supabase.from('reservations').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToRes(data) : null;
}

// ─── reservations ─────────────────────────────────────────────────────────────
export async function getReservations(filters = {}) {
  let q = supabase.from('reservations').select('*');
  if (filters.date)    q = q.eq('date', filters.date);
  if (filters.tableId) q = q.eq('table_id', filters.tableId);
  if (filters.status)  q = q.eq('status', filters.status);
  if (filters.source)  q = q.eq('source', filters.source);
  if (filters.guestId) q = q.eq('guest_id', filters.guestId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data || []).map(rowToRes);
  await expireStalePending(rows);
  return rows;
}

// Self-healing на каждом чтении (никто не смотрит в БД напрямую — только через
// getReservations): протухшие pending отменяются прямо тут, чтобы стол не
// выглядел «недоступным» вечно.
async function expireStalePending(rows) {
  const now = Date.now();
  const stale = rows.filter(r => r.status === 'pending' && (
    now - new Date(r.createdAt).getTime() > PENDING_CONFIRM_TIMEOUT_MS ||
    reservationInstant(r.date, r.timeFrom).getTime() < now - PENDING_PAST_ARRIVAL_GRACE_MS
  ));
  if (!stale.length) return;
  const cancelledAt = new Date().toISOString();
  const reason = 'Не подтверждена вовремя';
  await supabase.from('reservations').update({
    status: 'cancelled', cancelled_at: cancelledAt, cancellation_reason: reason,
  }).in('id', stale.map(r => r.id));
  for (const r of stale) {
    r.status = 'cancelled'; r.cancelledAt = cancelledAt; r.cancellationReason = reason;
    editStaffBookingMessage(r, null, '⌛️ Отменена автоматически — не подтверждена вовремя.').catch(() => {});
    clearStaffReminders(r).catch(() => {}); // убрать «Заявка ждёт N минут»
  }
}

// ─── walk-in занятость (table_occupancy) ─────────────────────────────────────
function rowToOcc(o) {
  return {
    id: o.id, tableId: o.table_id, source: o.source,
    reservationId: o.reservation_id || null,
    occupiedSince: o.occupied_since, freedAt: o.freed_at || null,
  };
}

export async function getOpenOccupancies() {
  const { data, error } = await supabase.from('table_occupancy').select('*').is('freed_at', null);
  if (error) throw new Error(error.message);
  return (data || []).map(rowToOcc);
}

/** Бармен отметил стол занятым (walk-in) или система — по seated-брони.
 *  Идемпотентно: уже открытая занятость → false, не ошибка. */
export async function setTableOccupied(tableId, { source = 'walk_in', reservationId = null } = {}) {
  const { error } = await supabase.from('table_occupancy').insert({
    id: generateId('occ'), table_id: tableId, source, reservation_id: reservationId,
    occupied_since: new Date().toISOString(),
  });
  if (error) {
    if (error.code === '23505') return false; // уже занят — двойной тап/гонка поллера
    throw new Error(error.message);
  }
  return true;
}

/** Бармен освобождает walk-in стол. Занятость по брони так не закрыть —
 *  для неё «Гости ушли»/«Не пришли» (completed/no_show закрывают её сами). */
export async function freeTableOccupancy(tableId) {
  const { data, error } = await supabase.from('table_occupancy')
    .select('*').eq('table_id', tableId).is('freed_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  if (data.source === 'reservation') {
    throw new Error('Стол занят по брони — отметьте «Гости ушли» или «Не пришли»');
  }
  await supabase.from('table_occupancy').update({ freed_at: new Date().toISOString() }).eq('id', data.id);
  return true;
}

async function closeOccupancyForReservation(reservationId) {
  await supabase.from('table_occupancy')
    .update({ freed_at: new Date().toISOString() })
    .eq('reservation_id', reservationId).is('freed_at', null);
}

// ─── статусы столов на плане (вычисляемые) ──────────────────────────────────
// vacant   — свободен;
// reserved — есть активная заявка/бронь на этот вечер («Бронь к 20:00»);
// occupied — занят по факту: seated-бронь ИЛИ walk-in отметка бармена.
// Правило одного вечера гарантирует максимум одну активную бронь на стол+дату.
async function statusMapForDate(date) {
  const evening = date || barEveningDate();
  const [reservations, occupancies] = await Promise.all([
    getReservations({ date: evening }),
    // walk-in занятость — состояние «сейчас», к будущим датам не относится
    evening === barEveningDate() ? getOpenOccupancies() : Promise.resolve([]),
  ]);
  const map = {};
  for (const o of occupancies) {
    map[o.tableId] = { status: 'occupied', occupancy: o, reservation: null };
  }
  for (const r of reservations) {
    if (!ACTIVE_STATUSES.includes(r.status)) continue;
    const cur = map[r.tableId];
    if (r.status === 'seated') {
      map[r.tableId] = { status: 'occupied', occupancy: cur?.occupancy || null, reservation: r };
    } else if (cur) {
      // стол уже занят walk-in'ом, но бронь на вечер существует — статус
      // «занят», бронь прикладываем для админки/бармена
      if (!cur.reservation) cur.reservation = r;
    } else {
      map[r.tableId] = { status: 'reserved', occupancy: null, reservation: r };
    }
  }
  return map;
}

// Публичная версия — без персональных данных гостя. time (второй аргумент)
// оставлен для совместимости вызовов, в модели v2 не используется: статус
// считается на весь вечер.
export async function getTablesWithStatus(date) {
  const evening = date || barEveningDate();
  const [tables, smap] = await Promise.all([getTablesMerged(), statusMapForDate(evening)]);
  return tables.map(tbl => {
    const s = smap[tbl.id] || { status: 'vacant', reservation: null, occupancy: null };
    const publicRes = s.reservation ? {
      timeFrom: s.reservation.timeFrom, guestsCount: s.reservation.guestsCount,
    } : null;
    return { ...tbl, activeSeatsCount: activeSeats(tbl), status: s.status, reservation: publicRes };
  });
}

export async function getTablesWithStatusAdmin(date) {
  const evening = date || barEveningDate();
  const [tables, smap] = await Promise.all([getTablesMerged(), statusMapForDate(evening)]);
  return tables.map(tbl => {
    const s = smap[tbl.id] || { status: 'vacant', reservation: null, occupancy: null };
    return {
      ...tbl, activeSeatsCount: activeSeats(tbl),
      status: s.status, reservation: s.reservation, occupancy: s.occupancy,
    };
  });
}

export async function createReservation(p) {
  const {
    tableId, date, timeFrom, guestsCount = 2,
    guestName, guestPhone = '', note = '',
    source = 'web', guestId = null, createdByAdminId = null,
  } = p;

  if (!guestName?.trim()) throw new Error('Имя гостя обязательно');
  if (!tableId) throw new Error('Стол не выбран');
  if (!date) throw new Error('Дата обязательна');
  if (!timeFrom) throw new Error('Время прихода обязательно');

  const timeTo = p.timeTo || minToTime(timeToMin(timeFrom) + LEGACY_TIME_TO_MIN);

  if (reservationInstant(date, timeFrom).getTime() < Date.now() - PAST_ARRIVAL_GRACE_MS) {
    throw new Error('Это время уже прошло — выберите другое');
  }

  const table = (await getTablesMerged()).find(t => t.id === tableId);
  if (!table) throw new Error('Такого стола нет на плане');

  // Правило одного вечера: активная бронь (pending/confirmed/seated) на дату
  // блокирует стол целиком — «по факту» значит, что конец брони неизвестен.
  const dayReservations = (await getReservations({ date }))
    .filter(r => ACTIVE_STATUSES.includes(r.status));
  if (dayReservations.some(r => r.tableId === tableId)) {
    throw new Error('Этот стол уже занят в выбранный вечер — выберите другой');
  }
  // Walk-in занятость блокирует бронь только на текущий вечер
  if (date === barEveningDate()) {
    const occ = await getOpenOccupancies();
    if (occ.some(o => o.tableId === tableId)) {
      throw new Error('Этот стол сейчас занят гостями — выберите другой');
    }
  }
  // Антиспам: не больше 2 активных заявок/броней на гостя на дату (§7.5 ТЗ)
  if (guestId) {
    const mine = dayReservations.filter(r => r.guestId === guestId && ['pending', 'confirmed'].includes(r.status));
    if (mine.length >= 2) {
      throw new Error('У вас уже есть две активные брони на этот вечер — отмените одну из них, чтобы создать новую');
    }
  }

  // Заблокированные владельцем даты (админ-панель бота / вкладка СТОЛЫ)
  await assertDateBookable(date);

  const depositPrice = table?.depositPrice ?? 0;
  const now = new Date().toISOString();
  // КАЖДУЮ заявку подтверждает бармен кнопкой → 'pending', в том числе
  // созданную персоналом вручную (решение владельца 2026-07-04: автоподтверждение
  // убрано — создание и подтверждение могут делать разные люди).
  const row = {
    id: generateId(),
    table_id: tableId,
    guest_id: guestId,
    source,
    status: 'pending',
    date,
    time_from: timeFrom,
    time_to: timeTo,
    guests_count: guestsCount,
    deposit_price: depositPrice,
    deposit_status: depositPrice > 0 ? 'pending' : 'not_required',
    created_by_admin_id: createdByAdminId,
    guest_name: guestName.trim(),
    guest_phone: guestPhone.trim(),
    note: note.trim(),
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('reservations').insert(row).select().single();
  if (error) {
    // Гонка: два гостя прошли проверку почти одновременно — второй ловит
    // нарушение уникального индекса (table_id, date) вместо создания дубля.
    if (error.code === '23505') throw new Error('Этот стол уже занят в выбранный вечер — выберите другой');
    throw new Error(error.message);
  }
  const res = rowToRes(data);

  // Заявка с кнопками подтверждения — best-effort: сбой уведомления не
  // должен ронять создание брони (стафф-чат может быть не настроен).
  sendStaffBookingRequest(res, table).catch(e => console.error('[booking] staff notify failed:', e.message));
  if (source === 'web') {
    // Мгновенное ЛС гостю от бота (сайт свой экран показывает сам)
    const depLine = depositPrice > 0
      ? `\n💰 Депозит ${depositPrice} ₽ — после подтверждения его можно оплатить в «Мои брони» на сайте.\n`
      : '\n';
    getGuestTelegramId(guestId).then(tgId => tgId && notifyGuestTg(tgId,
      `📨 *Заявка отправлена!*\n\n${tableStaffLabel(table, tableId)}\n📅 ${fmtDateRu(date)} · к ${timeFrom}${depLine}\n`
      + 'Бронь подтверждает бармен — обычно это занимает несколько минут. Уведомление придёт сюда же 🎷',
    )).catch(() => {});
  }
  return res;
}

// opts.editStaffMessage=false — когда вызывающий сам редактирует стафф-сообщение
// (кнопка «Отклонить» живёт прямо в нём, бот правит его через ctx).
export async function cancelReservation(id, reason = '', opts = {}) {
  const { data: existing, error: e1 } = await supabase.from('reservations').select('*').eq('id', id).single();
  if (e1 || !existing) throw new Error('Бронь не найдена');
  if (existing.status === 'cancelled') throw new Error('Бронь уже отменена');
  const r = rowToRes(existing);

  let depositStatus = r.depositStatus;
  if (r.depositStatus === 'paid_mock' && r.date && r.timeFrom) {
    const hoursUntil = (reservationInstant(r.date, r.timeFrom) - new Date()) / 3600000;
    depositStatus = hoursUntil >= BOOKING_RULES.freeCancellationHours ? 'refunded' : 'partially_retained';
  }
  const { data, error } = await supabase.from('reservations').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(),
    cancellation_reason: reason, deposit_status: depositStatus,
  }).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  const res = rowToRes(data);

  closeOccupancyForReservation(id).catch(() => {});
  // Стафф-сообщение с кнопками больше не актуально — правим его (best-effort)
  if (opts.editStaffMessage !== false) {
    editStaffBookingMessage(res, null, `🚫 ${reason || 'Отменена'}.`).catch(() => {});
  }
  clearStaffReminders(res).catch(() => {}); // убрать «Заявка ждёт N минут»
  return res;
}

// opts.fromStatus — атомарный переход «только из этого статуса»: двойной тап
// по кнопке или гонка двух барменов упирается в условие на уровне БД, второй
// вызов получает «уже обработана», а не повторное действие (двойной DM гостю,
// повторные баллы и т.п.).
export async function updateReservationStatus(id, newStatus, { fromStatus } = {}) {
  const { data: existing } = await supabase.from('reservations')
    .select('status, guest_id, table_id').eq('id', id).maybeSingle();
  if (!existing) throw new Error('Бронь не найдена');
  // Гость мог отменить бронь, пока у бармена на экране висит старый статус —
  // guard от «Подтвердить»/«Завершить» на брони в финальном статусе.
  // Финальные: cancelled/completed/no_show.
  if (FINAL_STATUSES.includes(existing.status)) {
    throw new Error('Бронь уже в финальном статусе — обновите список');
  }
  if (fromStatus && existing.status !== fromStatus) {
    throw new Error('Заявка уже обработана — обновите список');
  }

  const patch = { status: newStatus };
  if (newStatus === 'cancelled') patch.cancelled_at = new Date().toISOString();
  let q = supabase.from('reservations').update(patch).eq('id', id);
  if (fromStatus) q = q.eq('status', fromStatus);
  const { data, error } = await q.select().single();
  if (error) throw new Error(fromStatus ? 'Заявка уже обработана — обновите список' : 'Бронь не найдена');

  // Заявка ушла из pending (подтверждена/отклонена) → убрать накопившиеся
  // напоминания «Заявка ждёт N минут»; исходная карточка остаётся с итогом.
  // clearStaffReminders сам перечитает актуальные id из БД (гонка с поллером).
  if (existing.status === 'pending') {
    clearStaffReminders(id).catch(() => {});
  }

  // seated → стол занят по факту (строка occupancy); финал → занятость закрыта
  if (newStatus === 'seated') {
    await setTableOccupied(existing.table_id, { source: 'reservation', reservationId: id })
      .catch(e => console.error('[booking] occupancy open failed:', e.message));
  } else if (FINAL_STATUSES.includes(newStatus)) {
    closeOccupancyForReservation(id).catch(() => {});
  }

  // Уровень гостя вычисляется из подтверждённых броней на лету (см.
  // _lib/loyalty.js) — отдельного начисления при 'completed' больше нет.
  return rowToRes(data);
}

// ─── поллер (5-минутный цикл в bot-start.js) ─────────────────────────────────

/** Автоматика прихода: в time_from подтверждённой брони стол сам переходит в
 *  seated/occupied. Опоздания не автоматим — «Не пришли» решает бармен. */
export async function autoSeatDueReservations() {
  const evening = barEveningDate();
  const confirmed = await getReservations({ status: 'confirmed' });
  const now = Date.now();
  for (const r of confirmed) {
    // только текущий вечер: старые confirmed из прошлых дней не должны
    // внезапно «сесть» и занять сегодняшний план
    if (r.date !== evening) continue;
    if (reservationInstant(r.date, r.timeFrom).getTime() > now) continue;
    try {
      await updateReservationStatus(r.id, 'seated');
    } catch (e) {
      console.error('[autoSeat]', r.id, 'failed:', e.message);
    }
  }
}

const REMIND_FIRST_MS = 15 * 60 * 1000;
const REMIND_SECOND_MS = 45 * 60 * 1000;

function staffMentions() {
  const ids = (process.env.TELEGRAM_STAFF_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.map(id => `[🔔](tg://user?id=${id})`).join('');
}

/** Напоминания персоналу о висящих заявках: 15 минут → «⏳ Ждёт 15 мин»,
 *  ещё через 30 — второе с упоминанием TELEGRAM_STAFF_IDS. Дальше не спамим. */
export async function remindStalePendingBookings() {
  const pending = await getReservations({ status: 'pending' });
  const now = Date.now();
  const tables = await getTablesMerged();
  for (const r of pending) {
    if (r.status !== 'pending') continue; // только что протух в expireStalePending
    const age = now - new Date(r.createdAt).getTime();
    let header = null;
    if (r.staffReminderCount === 0 && age >= REMIND_FIRST_MS) {
      header = '⏳ *Заявка ждёт 15 минут*';
    } else if (r.staffReminderCount === 1 && age >= REMIND_SECOND_MS) {
      header = `⏳ *Заявка ждёт уже 45 минут!* ${staffMentions()}`;
    }
    if (!header) continue;
    try {
      const table = tables.find(t => t.id === r.tableId);
      // message_id напоминания сохраняем, чтобы удалить его при подтверждении/
      // отклонении/протухании заявки (clearStaffReminders) — иначе в теме
      // «Брони» копится шум поверх исходной карточки.
      const msgId = await notifyStaff(header + '\n\n' + staffBookingText(r, table), {
        threadId: STAFF_BOOKINGS_THREAD(),
        replyMarkup: staffConfirmKeyboard(r.id),
      });
      const nextIds = msgId
        ? [...(r.staffReminderMsgIds || []), msgId]
        : (r.staffReminderMsgIds || []);
      // Запись id ТОЛЬКО пока заявка всё ещё pending (.eq status): если бармен
      // подтвердил/отклонил её, пока летело это напоминание, его clearStaffReminders
      // уже отработал по пустому столбцу — не перезатираем его снапшотом (иначе
      // напоминание осталось бы висеть навсегда, гонка поллер↔подтверждение).
      const { data: upd } = await supabase.from('reservations')
        .update({ staff_reminder_count: r.staffReminderCount + 1, staff_reminder_msg_ids: nextIds })
        .eq('id', r.id).eq('status', 'pending').select('id');
      if (!upd?.length && msgId) {
        // Заявка уже не pending — только что отправленное напоминание убираем сами.
        await deleteStaffMessage(msgId).catch(() => {});
      }
    } catch (e) {
      console.error('[remindPending]', r.id, 'failed:', e.message);
    }
  }
}

// Ставится поллером (attendancePoller.js) сразу после отправки «Гость был?» в
// группу персонала — не начисление баллов и не смена статуса, просто дедуп-метка.
// В v2 бронь-часть поллера отключена, метка осталась для событий/истории.
export async function markAttendancePromptSent(id) {
  await supabase.from('reservations').update({ attendance_prompt_sent_at: new Date().toISOString() }).eq('id', id);
}

export async function updateReservation(id, updates) {
  const map = {
    tableId: 'table_id', date: 'date', timeFrom: 'time_from', timeTo: 'time_to',
    guestsCount: 'guests_count', guestName: 'guest_name', guestPhone: 'guest_phone',
    note: 'note', status: 'status',
  };
  const patch = {};
  for (const [k, v] of Object.entries(updates)) if (map[k]) patch[map[k]] = v;
  const { data, error } = await supabase.from('reservations').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Бронь не найдена');
  return rowToRes(data);
}

export async function payDeposit(reservationId) {
  const { data: existing, error: e1 } = await supabase.from('reservations').select('*').eq('id', reservationId).single();
  if (e1 || !existing) throw new Error('Бронь не найдена');
  const r = rowToRes(existing);
  if (r.status === 'cancelled') throw new Error('Время на оплату истекло, бронь отменена — выберите стол заново');
  if (r.depositStatus === 'paid_mock') throw new Error('Депозит уже оплачен');
  if (!r.depositPrice || r.depositPrice <= 0) throw new Error('Депозит не требуется');
  const txId = 'tx_mock_' + Date.now();
  // Статус брони НЕ меняем: подтверждает только бармен кнопкой (оплата
  // депозита — не подтверждение; правило «без автоподтверждений», 2026-07-04).
  const { data, error } = await supabase.from('reservations').update({
    deposit_status: 'paid_mock', deposit_transaction_id: txId,
  }).eq('id', reservationId).select().single();
  if (error) throw new Error(error.message);
  const res = rowToRes(data);
  // Барменам видно, что депозит уже внесён — правим карточку заявки.
  // Если заявка ещё pending, кнопки подтверждения обязаны остаться на месте.
  if (res.staffMessageId) {
    getTablesMerged().then(tables => {
      const table = tables.find(t => t.id === res.tableId);
      const markup = res.status === 'pending' ? staffConfirmKeyboard(res.id) : undefined;
      return editStaffMessage(res.staffMessageId,
        staffBookingText(res, table) + '\n\n💰 Депозит оплачен гостем.',
        { replyMarkup: markup });
    }).catch(() => {});
  }
  return res;
}

export async function setTableSeatsCount(tableId, count) {
  const n = parseInt(count, 10);
  if (!Number.isFinite(n) || n < 1 || n > 30) throw new Error('Число мест — от 1 до 30');
  const cfg = await loadTableConfig();
  if (!cfg[tableId]) cfg[tableId] = {};
  cfg[tableId].seatsCount = n;
  await saveTableConfig(cfg);
  return n;
}

// ─── table config setters ─────────────────────────────────────────────────────
export async function getTableDepositPrices() {
  return (await getTablesMerged()).map(t => ({
    id: t.id, name: t.name || t.id, zone: t.zone, type: t.type, depositPrice: t.depositPrice ?? 0,
  }));
}

export async function setTableDepositPrice(tableId, price) {
  const cfg = await loadTableConfig();
  if (!cfg[tableId]) cfg[tableId] = {};
  cfg[tableId].depositPrice = Math.max(0, Number(price) || 0);
  await saveTableConfig(cfg);
}

export async function setTableSeatActive(tableId, seatIndex, active) {
  const cfg = await loadTableConfig();
  if (!cfg[tableId]) cfg[tableId] = {};
  if (!cfg[tableId].seats) {
    const src = TABLES.find(t => t.id === tableId);
    cfg[tableId].seats = src ? src.seats.map(s => ({ active: s.active })) : [];
  }
  while (cfg[tableId].seats.length <= seatIndex) cfg[tableId].seats.push({ active: true });
  cfg[tableId].seats[seatIndex] = { ...cfg[tableId].seats[seatIndex], active };
  await saveTableConfig(cfg);
}
