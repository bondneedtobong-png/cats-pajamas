// E2E бот-сценариев (бронирование v2 §8): РЕАЛЬНЫЕ buildBot()+handleUpdate()
// и api/_lib/booking.js против мок-PostgREST; api.telegram.org перехвачен —
// отправленные сообщения/кнопки/фото записываются и проверяются.
// Запуск из корня проекта: node devtools/bot_e2e.mjs  → ждём ALL SCENARIOS PASS.
process.env.SUPABASE_URL = 'http://127.0.0.1:54322';
process.env.SUPABASE_ANON_KEY = 'x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
process.env.SESSION_SECRET = 'e2e-secret';
process.env.TELEGRAM_BOT_TOKEN = '999:e2e';
process.env.TELEGRAM_ADMIN_IDS = '111';
process.env.TELEGRAM_STAFF_IDS = '555';
process.env.TELEGRAM_STAFF_CHAT_ID = '-100500';
process.env.TELEGRAM_STAFF_BOOKINGS_THREAD_ID = '7';
process.env.TELEGRAM_CHANNEL = '@catstest'; // getChatMember в перехвате отвечает member — гейт подписки проходит
import os from 'node:os';
import { promises as fsp } from 'node:fs';
process.env.EVENT_UPLOADS_DIR = os.tmpdir() + '/cpjc_e2e_events'; // фото событий пишем во временную папку
await fsp.rm(process.env.EVENT_UPLOADS_DIR, { recursive: true, force: true }).catch(() => {});
// 1×1 PNG — валидный вход для sharp при «скачивании» фото из Telegram в тестах.
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// ── Перехват Telegram API ──
const tgCalls = [];
let tgMsgId = 1000;
function tgIntercept(url, opts) {
  const s = String(url);
  // Скачивание файла (getFile → https://api.telegram.org/file/bot<token>/<path>)
  // — отдаём валидный 1×1 PNG байтами, чтобы sharp мог его обработать.
  if (s.includes('/file/bot')) return new Response(PNG_1x1, { status: 200 });
  const method = s.split('/').pop().split('?')[0];
  let body = {};
  if (opts?.body && typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch {} }
  else if (opts?.body && typeof opts.body

.entries === 'function') {
    for (const [k, v] of opts.body.entries()) {
      body[k] = typeof v === 'string' ? (k === 'reply_markup' ? JSON.parse(v) : v) : '[blob]';
    }
  }
  if (body.caption && !body.text) body.text = body.caption; // caption ≙ text для проверок
  tgCalls.push({ method, body });
  let result = true;
  if (method === 'getMe') result = { id: 999, is_bot: true, first_name: 'bot', username: 'cats_pajama_bot' };
  if (method === 'getChatMember') result = { status: 'member', user: { id: 0, is_bot: false, first_name: 'x' } };
  if (method === 'sendMessage') result = { message_id: ++tgMsgId, chat: { id: body.chat_id }, date: 0, text: body.text || '' };
  if (method === 'sendPhoto') result = { message_id: ++tgMsgId, chat: { id: body.chat_id }, date: 0 };
  if (method === 'getFile') result = { file_id: body.file_id, file_unique_id: 'u', file_path: `photos/f${++tgMsgId}.jpg` };
  if (method === 'sendMediaGroup') {
    const media = Array.isArray(body.media) ? body.media : (() => { try { return JSON.parse(body.media || '[]'); } catch { return []; } })();
    result = media.map(() => ({ message_id: ++tgMsgId, chat: { id: body.chat_id }, date: 0 }));
  }
  if (method === 'forwardMessage') result = { message_id: ++tgMsgId, chat: { id: body.chat_id }, date: 0 };
  if (method === 'editMessageText') result = { message_id: body.message_id, chat: { id: body.chat_id }, date: 0, text: body.text || '' };
  if (method === 'editMessageCaption') result = { message_id: body.message_id, chat: { id: body.chat_id }, date: 0 };
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// booking.js/staffNotify используют глобальный fetch
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.telegram.org')) return tgIntercept(url, opts);
  return realFetch(url, opts);
};

// grammY ходит через пакет node-fetch (не через глобальный fetch) —
// подменяем его в require.cache ДО загрузки grammy
import { createRequire } from 'node:module';
const requireCjs = createRequire(new URL('../node_modules/grammy/out/shim.node.js', import.meta.url));
const nodeFetchPath = requireCjs.resolve('node-fetch');
const mockNodeFetch = async (url, opts) => tgIntercept(url, opts);
mockNodeFetch.default = mockNodeFetch;
requireCjs.cache[nodeFetchPath] = {
  id: nodeFetchPath, filename: nodeFetchPath, loaded: true, exports: mockNodeFetch,
};

import { createDb, startPgrestMock } from './pgrest-mock.mjs';
const db = createDb({
  users: [
    { id: 'u_g1', name: 'Аня', phone: '79991112233', telegram_id: '424242', role: 'guest', loyalty_points: 0 },
    { id: 'u_g2', name: 'Борис', phone: '79994445566', telegram_id: '515151', role: 'guest', loyalty_points: 0 },
  ],
});
await startPgrestMock(db, 54322);

const P = new URL('../', import.meta.url).href; // корень проекта (devtools на уровень ниже)
const bk = await import(P + 'api/_lib/booking.js');
const bt = await import(P + 'src/booking/barTime.js');
const loy = await import(P + 'api/_lib/loyalty.js');
const { buildBot } = await import(P + 'api/bot.js');

const bot = buildBot();
await bot.init();

let updId = 1;
async function cb(data, fromId, { messageId = 1, text = 'msg', reply } = {}) {
  tgCalls.length = 0;
  await bot.handleUpdate({
    update_id: updId++,
    callback_query: {
      id: 'cbq' + updId, chat_instance: 'ci',
      from: { id: fromId, is_bot: false, first_name: 'Стафф', username: 'bar_staff' },
      message: {
        message_id: messageId, date: 0, text,
        chat: { id: -100500, type: 'supergroup' },
        message_thread_id: 7,
      },
      data,
    },
  });
}
async function groupText(text, fromId, replyToId) {
  tgCalls.length = 0;
  await bot.handleUpdate({
    update_id: updId++,
    message: {
      message_id: ++tgMsgId, date: Math.floor(Date.now() / 1000), text,
      from: { id: fromId, is_bot: false, first_name: 'Стафф', username: 'bar_staff' },
      chat: { id: -100500, type: 'supergroup' },
      message_thread_id: 7,
      reply_to_message: replyToId ? { message_id: replyToId, date: 0, chat: { id: -100500, type: 'supergroup' } } : undefined,
    },
  });
}
// Личный чат с ботом (гость/админ): callback и текст — для панели и мастеров
async function cbPriv(data, fromId, { messageId = 9, text = 'msg', username = 'user' } = {}) {
  tgCalls.length = 0;
  await bot.handleUpdate({
    update_id: updId++,
    callback_query: {
      id: 'cbq' + updId, chat_instance: 'ci',
      from: { id: fromId, is_bot: false, first_name: 'Юзер', username },
      message: { message_id: messageId, date: 0, text, chat: { id: fromId, type: 'private' } },
      data,
    },
  });
}
async function privText(text, fromId, { username = 'user' } = {}) {
  tgCalls.length = 0;
  await bot.handleUpdate({
    update_id: updId++,
    message: {
      message_id: ++tgMsgId, date: Math.floor(Date.now() / 1000), text,
      from: { id: fromId, is_bot: false, first_name: 'Юзер', username },
      chat: { id: fromId, type: 'private' },
    },
  });
}
// Личное фото-сообщение (шаг ev_photos мастера события). Два «размера» —
// бот берёт последний (самый большой) и «скачивает» его (перехват → 1×1 PNG).
async function privPhoto(fromId, { username = 'user' } = {}) {
  tgCalls.length = 0;
  const uid = ++tgMsgId;
  await bot.handleUpdate({
    update_id: updId++,
    message: {
      message_id: uid, date: Math.floor(Date.now() / 1000),
      from: { id: fromId, is_bot: false, first_name: 'Юзер', username },
      chat: { id: fromId, type: 'private' },
      photo: [
        { file_id: `ph_s_${uid}`, file_unique_id: `us${uid}`, width: 90, height: 60 },
        { file_id: `ph_b_${uid}`, file_unique_id: `ub${uid}`, width: 1280, height: 800 },
      ],
    },
  });
}

const calls = (m) => tgCalls.filter(c => c.method === m);
const res = (id) => db.t('reservations').find(r => r.id === id);
const openOcc = (tableId) => db.t('table_occupancy').find(o => o.table_id === tableId && o.freed_at == null);
const confirmedCount = (uid) => loy.countConfirmedBookings(uid);

let fails = 0;
function ok(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  ← ' + extra}`);
  if (!cond) fails++;
}

const evening = bt.barEveningDate();
const slots = bt.buildTimeSlots(evening);
const slot = slots[Math.max(0, slots.length - 3)]; // будущий слот сегодня

// ═══ A. Счастливый путь ═══
console.log('\n── A. Счастливый путь ──');
tgCalls.length = 0;
const rA = await bk.createReservation({
  tableId: 'T2', date: evening, timeFrom: slot, guestsCount: 2,
  guestName: 'Аня', guestPhone: '+79991112233', note: 'у сцены', source: 'web', guestId: 'u_g1',
});
await new Promise(r => setTimeout(r, 150)); // fire-and-forget уведомления
ok('A1 заявка pending', rA.status === 'pending');
const staffMsg = [...calls('sendPhoto'), ...calls('sendMessage')].find(c => String(c.body.chat_id) === '-100500');
ok('A2 стафф-сообщение с кнопками', !!staffMsg && JSON.stringify(staffMsg.body.reply_markup).includes(`stok:${rA.id}`), JSON.stringify(staffMsg?.body));
ok('A3 стафф-текст: тема "Брони" + без T-айдишников', String(staffMsg.body.message_thread_id) === '7' && staffMsg.body.text.includes('Основной зал, стол №3'), staffMsg.body.text);
ok('A4 ЛС гостю «заявка отправлена»', calls('sendMessage').some(c => String(c.body.chat_id) === '424242' && c.body.text.includes('Заявка отправлена')));
const staffMsgId = res(rA.id).staff_message_id;
ok('A5 staff_message_id сохранён', !!staffMsgId);

await cb(`stok:${rA.id}`, 555, { messageId: staffMsgId });
await new Promise(r => setTimeout(r, 150));
ok('A6 бармен подтвердил → confirmed', res(rA.id).status === 'confirmed');
ok('A7 стафф-сообщение отредактировано «Подтвердил»', [...calls('editMessageCaption'), ...calls('editMessageText')].some(c => c.body.text.includes('✅ Подтвердил')), JSON.stringify([...calls('editMessageCaption'), ...calls('editMessageText')]));
ok('A8 гостю фото-ЛС «Бронь подтверждена» с описанием стола', [...calls('sendPhoto'), ...calls('sendMessage')].some(c => String(c.body.chat_id) === '424242' && (c.body.text || '').includes('Бронь подтверждена') && (c.body.text || '').includes('Основной зал, стол №3')));

await cb(`stok:${rA.id}`, 555, { messageId: staffMsgId }); // двойной тап
ok('A9 двойной тап → «уже обработана»', calls('answerCallbackQuery').some(c => (c.body.text || '').includes('уже обработана')), JSON.stringify(calls('answerCallbackQuery')));

// time_from прошёл → поллер сам сажает гостей
res(rA.id).time_from = bt.minToTime((bt.barNow().minutes + 24 * 60 - 10) % (24 * 60));
await bk.autoSeatDueReservations();
ok('A10 авто-seated в time_from', res(rA.id).status === 'seated');
ok('A11 occupancy открыта (source=reservation)', openOcc('T2')?.source === 'reservation');
let plan = await bk.getTablesWithStatus(evening);
ok('A12 план: стол occupied', plan.find(t => t.id === 'T2').status === 'occupied');

await cb(`tbldone:${rA.id}`, 555);
await new Promise(r => setTimeout(r, 100));
ok('A13 «Гости ушли» → completed', res(rA.id).status === 'completed');
ok('A14 occupancy закрыта', !openOcc('T2'));
plan = await bk.getTablesWithStatus(evening);
ok('A15 план: стол vacant', plan.find(t => t.id === 'T2').status === 'vacant');
const lvlAfter = await loy.getGuestLevel('u_g1');
ok('A16 уровень: 1 подтверждённая бронь → 2 «Вино»', lvlAfter.level.num === 2 && lvlAfter.bookings === 1, JSON.stringify(lvlAfter));
await cb(`tbldone:${rA.id}`, 555); // повторно
ok('A17 повторное «Гости ушли» → отказ, счётчик броней не задвоился', (await confirmedCount('u_g1')) === 1);

// ═══ B. Отклонение с причиной ═══
console.log('\n── B. Отклонение ──');
const rB = await bk.createReservation({ tableId: 'T3', date: evening, timeFrom: slot, guestName: 'Аня', source: 'web', guestId: 'u_g1' });
await new Promise(r => setTimeout(r, 120));
const msgB = res(rB.id).staff_message_id;
await cb(`stno:${rB.id}`, 555, { messageId: msgB });
ok('B1 показаны быстрые причины', calls('editMessageReplyMarkup').some(c => JSON.stringify(c.body).includes('stnor:' + rB.id + ':nomest')));
await cb(`stnor:${rB.id}:nomest`, 555, { messageId: msgB });
await new Promise(r => setTimeout(r, 120));
ok('B2 отклонена с причиной', res(rB.id).status === 'cancelled' && res(rB.id).cancellation_reason === 'Нет свободных мест');
ok('B3 гостю извинение с причиной и альтернативами', calls('sendMessage').some(c => String(c.body.chat_id) === '424242' && c.body.text.includes('не подтверждена') && c.body.text.toLowerCase().includes('нет свободных мест') && c.body.text.includes('стойка')));
ok('B4 стафф-сообщение «Отклонил»', [...calls('editMessageCaption'), ...calls('editMessageText')].some(c => c.body.text.includes('❌ Отклонил')));

// Своя причина через Reply
const rB2 = await bk.createReservation({ tableId: 'T3', date: evening, timeFrom: slot, guestName: 'Борис', source: 'web', guestId: 'u_g2' });
await new Promise(r => setTimeout(r, 120));
const msgB2 = res(rB2.id).staff_message_id;
await cb(`stno:${rB2.id}`, 555, { messageId: msgB2 });
await cb(`stnor:${rB2.id}:custom`, 555, { messageId: msgB2 });
const prompt = calls('sendMessage').find(c => (c.body.text || '').includes('ОТВЕТОМ'));
ok('B5 промпт «ответьте причиной»', !!prompt);
const promptId = tgMsgId; // id последнего отправленного (промпта)
await groupText('В этот вечер закрытая репетиция оркестра', 555, promptId);
await new Promise(r => setTimeout(r, 120));
ok('B6 своя причина применилась', res(rB2.id).status === 'cancelled' && res(rB2.id).cancellation_reason.includes('репетиция'), res(rB2.id).cancellation_reason);
ok('B7 гостю ЛС со своей причиной', calls('sendMessage').some(c => String(c.body.chat_id) === '515151' && c.body.text.includes('репетиция')));

// ═══ C. Отмена гостем → стафф-сообщение правится ═══
console.log('\n── C. Отмена гостем ──');
const rC = await bk.createReservation({ tableId: 'T5', date: evening, timeFrom: slot, guestName: 'Аня', source: 'web', guestId: 'u_g1' });
await new Promise(r => setTimeout(r, 120));
tgCalls.length = 0;
await bk.cancelReservation(rC.id, 'Отменена гостем на сайте');
await new Promise(r => setTimeout(r, 120));
ok('C1 pending: стафф-сообщение отредактировано', [...calls('editMessageCaption'), ...calls('editMessageText')].some(c => c.body.message_id === res(rC.id).staff_message_id && c.body.text.includes('🚫')));
const rC2 = await bk.createReservation({ tableId: 'T5', date: evening, timeFrom: slot, guestName: 'Аня', source: 'web', guestId: 'u_g1' });
await new Promise(r => setTimeout(r, 120));
await cb(`stok:${rC2.id}`, 555, { messageId: res(rC2.id).staff_message_id });
tgCalls.length = 0;
await bk.cancelReservation(rC2.id, 'Отменена гостем через Telegram');
await new Promise(r => setTimeout(r, 120));
ok('C2 confirmed: стафф-сообщение отредактировано', [...calls('editMessageCaption'), ...calls('editMessageText')].some(c => c.body.text.includes('🚫')));
// кнопка по отменённой гостем брони
await cb(`stok:${rC2.id}`, 555, { messageId: res(rC2.id).staff_message_id });
ok('C3 подтверждение отменённой → «уже обработана: отменена»', calls('answerCallbackQuery').some(c => (c.body.text || '').includes('уже обработана')));

// ═══ D. Walk-in ═══
console.log('\n── D. Walk-in ──');
await cb('tblocc:T6', 555);
ok('D1 стол занят walk-in', openOcc('T6')?.source === 'walk_in');
plan = await bk.getTablesWithStatus(evening);
ok('D2 план: occupied', plan.find(t => t.id === 'T6').status === 'occupied');
await cb('tblocc:T6', 555);
ok('D3 повторное занятие → «уже занят» (идемпотентно)', calls('answerCallbackQuery').some(c => (c.body.text || '').includes('уже занят')));
// walk-in блокирует бронь на сегодня
let evErr = '';
try { await bk.createReservation({ tableId: 'T6', date: evening, timeFrom: slot, guestName: 'Аня', guestId: 'u_g1' }); } catch (e) { evErr = e.message; }
ok('D4 бронь walk-in-стола на сегодня отбита', evErr.includes('занят'), evErr);
await cb('tblfree:T6', 555);
ok('D5 стол освобождён', !openOcc('T6'));
ok('D6 walk-in не влияет на уровень (нет брони — нет счётчика)', (await confirmedCount('u_g1')) === 1);

// ═══ E. Гонка: два гостя ловят один стол ═══
console.log('\n── E. Гонка ──');
const [e1, e2] = await Promise.allSettled([
  bk.createReservation({ tableId: 'T4', date: evening, timeFrom: slot, guestName: 'Аня', guestId: 'u_g1' }),
  bk.createReservation({ tableId: 'T4', date: evening, timeFrom: slot, guestName: 'Борис', guestId: 'u_g2' }),
]);
const okCount = [e1, e2].filter(x => x.status === 'fulfilled').length;
const rejMsg = [e1, e2].find(x => x.status === 'rejected')?.reason?.message || '';
ok('E1 ровно одна бронь прошла', okCount === 1, `ok=${okCount}`);
ok('E2 второй получил вежливый отказ', rejMsg.includes('занят'), rejMsg);
const rE = (e1.status === 'fulfilled' ? e1 : e2).value;

// ═══ F. «Не пришли» ═══
console.log('\n── F. No-show ──');
await new Promise(r => setTimeout(r, 120));
await cb(`stok:${rE.id}`, 555, { messageId: res(rE.id).staff_message_id });
await cb(`tblseat:${rE.id}`, 555); // бармен вручную «пришли»
ok('F1 вручную seated', res(rE.id).status === 'seated' && openOcc('T4')?.source === 'reservation');
const cntBeforeF = await confirmedCount(res(rE.id).guest_id);
await cb(`tblno:${rE.id}`, 555);
ok('F2 «Не пришли» → no_show', res(rE.id).status === 'no_show');
ok('F3 occupancy закрыта, стол свободен', !openOcc('T4'));
ok('F4 неявка выпала из счётчика подтверждённых броней', (await confirmedCount(res(rE.id).guest_id)) === cntBeforeF - 1);

// ═══ G. Напоминания и протухание ═══
console.log('\n── G. Напоминания/протухание ──');
const rG = await bk.createReservation({ tableId: 'T7', date: evening, timeFrom: slot, guestName: 'Борис', guestId: 'u_g2' });
await new Promise(r => setTimeout(r, 120));
res(rG.id).created_at = new Date(Date.now() - 16 * 60000).toISOString();
tgCalls.length = 0;
await bk.remindStalePendingBookings();
ok('G1 напоминание «ждёт 15 минут»', calls('sendMessage').some(c => (c.body.text || '').includes('15 минут')));
ok('G2 счётчик=1', res(rG.id).staff_reminder_count === 1);
res(rG.id).created_at = new Date(Date.now() - 46 * 60000).toISOString();
tgCalls.length = 0;
await bk.remindStalePendingBookings();
ok('G3 второе напоминание с упоминанием персонала', calls('sendMessage').some(c => (c.body.text || '').includes('45 минут') && (c.body.text || '').includes('tg://user?id=555')));
tgCalls.length = 0;
await bk.remindStalePendingBookings();
ok('G4 дальше не спамим', calls('sendMessage').length === 0);
// протухание: заявка старше 6 часов
res(rG.id).created_at = new Date(Date.now() - 6.1 * 3600000).toISOString();
tgCalls.length = 0;
await bk.getReservations({ date: evening });
await new Promise(r => setTimeout(r, 120));
ok('G5 протухла → cancelled «Не подтверждена вовремя»', res(rG.id).status === 'cancelled' && res(rG.id).cancellation_reason === 'Не подтверждена вовремя');
ok('G6 стафф-сообщение помечено ⌛️', [...calls('editMessageCaption'), ...calls('editMessageText')].some(c => (c.body.text || '').includes('⌛️')));

// ═══ H. «Забронировать текстом» — свободная заявка без выбора стола ═══
console.log('\n── H. Текстовая заявка ──');
await cbPriv('bk', 424242, { username: 'anya_jazz' });
ok('H1 мастер: шаг 1 — дата и время текстом', calls('editMessageText').some(c => (c.body.text || '').includes('Шаг 1')));
await privText('12 июля, 21:00', 424242, { username: 'anya_jazz' });
ok('H2 шаг 2 — сколько гостей', calls('sendMessage').some(c => (c.body.text || '').includes('Шаг 2')));
await privText('нас будет 8', 424242, { username: 'anya_jazz' });
ok('H3 шаг 3 — сообщение барменам', calls('sendMessage').some(c => (c.body.text || '').includes('Шаг 3')));
await privText('Хотим диваны, у нас день рождения', 424242, { username: 'anya_jazz' });
const fbPrev = calls('sendMessage').find(c => (c.body.text || '').includes('Проверьте заявку'));
ok('H4 превью с кнопкой отправки', !!fbPrev && JSON.stringify(fbPrev.body.reply_markup || {}).includes('fbsend'), JSON.stringify(fbPrev?.body || {}).slice(0, 300));
await cbPriv('fbsend', 424242, { username: 'anya_jazz' });
await new Promise(r => setTimeout(r, 150));
const fbStaff = calls('sendMessage').find(c => String(c.body.chat_id) === '-100500');
ok('H5 заявка в стафф-теме: дата, гости, текст, контакты',
  !!fbStaff && fbStaff.body.text.includes('12 июля') && fbStaff.body.text.includes('Гостей: 8')
  && fbStaff.body.text.includes('день рождения') && fbStaff.body.text.includes('anya')
  && String(fbStaff.body.message_thread_id) === '7',
  JSON.stringify(fbStaff?.body || {}).slice(0, 400));
ok('H6 гостю — «заявка у барменов»', calls('editMessageText').some(c => (c.body.text || '').includes('у барменов')));

// ═══ I. Админ-панель в боте ═══
console.log('\n── I. Админ-панель ──');
tgCalls.length = 0;
await bot.handleUpdate({
  update_id: updId++,
  message: {
    message_id: ++tgMsgId, date: Math.floor(Date.now() / 1000), text: '/admin',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    from: { id: 555, is_bot: false, first_name: 'Стафф', username: 'bar_staff' },
    chat: { id: 555, type: 'private' },
  },
});
const panelMsg = calls('sendMessage').find(c => (c.body.text || '').includes('Админ-панель'));
const panelKb = JSON.stringify(panelMsg?.body.reply_markup || {});
ok('I1 /admin (стафф): панель с 4 разделами', !!panelMsg && panelKb.includes('"tbl"') && panelKb.includes('"adm"') && panelKb.includes('"ev"') && panelKb.includes('"bc"'), panelKb);

await privText('🏠 Меню', 555, { username: 'bar_staff' });
const staffMenu = calls('sendMessage').find(c => (c.body.text || '').includes('Выберите действие'));
const staffMenuKb = JSON.stringify(staffMenu?.body.reply_markup || {});
ok('I2 меню персонала: кнопка админ-панели вместо «Столы сейчас»', staffMenuKb.includes('"adminmenu"') && !staffMenuKb.includes('"tbl"'), staffMenuKb);

await privText('🏠 Меню', 424242, { username: 'anya_jazz' });
const guestMenuMsg = calls('sendMessage').find(c => (c.body.text || '').includes('Выберите действие'));
ok('I3 у гостя админ-кнопки нет', !JSON.stringify(guestMenuMsg?.body.reply_markup || {}).includes('adminmenu'));

await cbPriv('adminmenu', 424242);
ok('I4 гостю панель не открывается', !calls('editMessageText').some(c => (c.body.text || '').includes('Админ-панель')));

const rI = await bk.createReservation({ tableId: 'T7', date: evening, timeFrom: slot, guestName: 'Борис', guestPhone: '+79994445566', source: 'web', guestId: 'u_g2' });
await new Promise(r => setTimeout(r, 120));
db.t('users').find(u => u.id === 'u_g2').telegram_username = 'boris_bar';
await cbPriv('adm', 555);
const admList = calls('editMessageText')[0];
ok('I5 «Текущие брони»: бронь — кнопка admv', JSON.stringify(admList?.body.reply_markup || {}).includes(`admv:${rI.id}`), JSON.stringify(admList?.body.reply_markup || {}).slice(0, 300));

await cbPriv(`admv:${rI.id}`, 555);
const card = calls('editMessageText')[0];
const cardKb = JSON.stringify(card?.body.reply_markup || {});
ok('I6 карточка: имя гостя + действия по статусу', (card?.body.text || '').includes('Борис') && cardKb.includes(`admok:${rI.id}`) && cardKb.includes(`admno:${rI.id}`), card?.body.text);
ok('I7 карточка: телефон и @username гостя', (card?.body.text || '').includes('79994445566') && (card?.body.text || '').includes('boris'), card?.body.text);
ok('I8 карточка: кнопка «К списку»', cardKb.includes('"adm"'), cardKb);

await cbPriv(`admok:${rI.id}`, 555);
await new Promise(r => setTimeout(r, 150));
ok('I9 подтверждена из карточки, гость получил ЛС', res(rI.id).status === 'confirmed'
  && [...calls('sendMessage'), ...calls('sendPhoto')].some(c => String(c.body.chat_id) === '515151'));
ok('I10 карточка перерисована с новым статусом', calls('editMessageText').some(c => (c.body.text || '').includes('подтверждена')));

// ═══ J. Событие (сайт+канал+рассылка) и произвольная рассылка ═══
console.log('\n── J. Событие и рассылка ──');
await cbPriv('ev', 111);
ok('J1 меню событий открылось', calls('editMessageText').some(c => (c.body.text || '').includes('Событ')));
await cbPriv('evadd', 111);
await privText('Вечер джаза', 111);
ok('J2 мастер спросил дату', calls('sendMessage').some(c => (c.body.text || '').includes('ДД.ММ')));
await privText('31.12.2026', 111);
await privText('20:00', 111);
await privText('Живой квартет и старые пластинки', 111);
ok('J3a после описания — шаг фото', calls('sendMessage').some(c => (c.body.text || '').includes('Пришлите фото') && JSON.stringify(c.body.reply_markup || {}).includes('evphotosdone')), JSON.stringify(calls('sendMessage').map(c => c.body.text)));
await cbPriv('evphotosdone', 111); // «Без фото» → превью (регресс: событие без фото)
const preview = calls('sendMessage').find(c => (c.body.text || '').includes('Проверьте событие'));
const previewKb = JSON.stringify(preview?.body.reply_markup || {});
ok('J3 превью (без фото): переключатель рассылки + публикация', !!preview && previewKb.includes('evnotify') && previewKb.includes('evsave'), previewKb);

await cbPriv('evnotify', 111);
ok('J4 переключатель: рассылка выключилась', calls('editMessageText').some(c => JSON.stringify(c.body.reply_markup || {}).includes('НЕТ')));
await cbPriv('evnotify', 111); // включить обратно

await cbPriv('evsave', 111);
await new Promise(r => setTimeout(r, 250));
const evRow = db.t('events').find(e => e.title === 'Вечер джаза');
ok('J5 событие в БД → видно на сайте', !!evRow && evRow.event_date === '2026-12-31' && evRow.active === true, JSON.stringify(evRow || {}));
const chPost = calls('sendMessage').find(c => c.body.chat_id === '@catstest');
ok('J6 пост в канале с кнопкой «Я приду»', !!chPost && JSON.stringify(chPost.body.reply_markup || {}).includes('rsvp:'), JSON.stringify(chPost?.body || {}).slice(0, 300));
const fwds = calls('forwardMessage');
ok('J7 пост переслан подписчикам из канала', fwds.length >= 2 && fwds.every(c => String(c.body.from_chat_id) === '@catstest'), JSON.stringify(fwds));
ok('J8 отчёт админу: сайт+канал+рассылка', calls('editMessageText').some(c => (c.body.text || '').includes('сайте') && (c.body.text || '').includes('канале') && (c.body.text || '').includes('доставлено')), JSON.stringify(calls('editMessageText').map(c => c.body.text)));

await cbPriv('bc', 111);
ok('J9 промпт рассылки', calls('editMessageText').some(c => (c.body.text || '').includes('Рассылка')));
await privText('Сегодня скидка на джин *для своих*!', 111);
const bcPrev = calls('sendMessage').find(c => (c.body.text || '').includes('Гости получат'));
ok('J10 превью рассылки с подтверждением', !!bcPrev && JSON.stringify(bcPrev.body.reply_markup || {}).includes('bcsend'), JSON.stringify(bcPrev?.body || {}).slice(0, 300));
await cbPriv('bcsend', 111);
await new Promise(r => setTimeout(r, 200));
const bcMsgs = calls('sendMessage').filter(c => (c.body.text || '').includes('скидка на джин'));
ok('J11 текст ушёл гостям как есть (без Markdown-парсинга)', bcMsgs.length >= 2 && bcMsgs.every(c => !c.body.parse_mode), JSON.stringify(bcMsgs.map(c => c.body)));

await cbPriv('loy', 424242, { username: 'anya_jazz' });
const loyMsg = calls('editMessageText')[0];
ok('J12 «Мой уровень»: уровень по подтверждённым броням, без баллов/колеса',
  (loyMsg?.body.text || '').includes('Ваш уровень') && (loyMsg?.body.text || '').includes('Вино')
  && !(loyMsg?.body.text || '').includes('колес') && !(loyMsg?.body.text || '').includes('Баллы'),
  loyMsg?.body.text);

// ═══ K. Депозит, ручная бронь pending, настройка столов, даты ═══
console.log('\n── K. Депозит и настройки ──');
await cbPriv('tblcfg', 111);
ok('K1 «Настроить столы»: столы кнопками', calls('editMessageText').some(c => JSON.stringify(c.body.reply_markup || {}).includes('tccard:T3')));
await cbPriv('tccard:T3', 111);
// grammY шлёт фото multipart-стримом — мок не разбирает caption, поэтому
// проверяем сам факт отправки фото (текстовый фолбэк содержал бы «Депозит»)
const tcCardSent = calls('sendPhoto').length > 0
  || calls('sendMessage').some(c => (c.body.text || '').includes('Депозит'));
ok('K2 карточка стола (фото плана + настройки)', tcCardSent, JSON.stringify(tgCalls.map(c => c.method)));
await cbPriv('tcdep:T3', 111);
await privText('1000', 111);
let t3 = (await bk.getTablesMerged()).find(t => t.id === 'T3');
ok('K3 депозит 1000 ₽ сохранён', t3.depositPrice === 1000, JSON.stringify(t3.depositPrice));
await cbPriv('tcseats:T3', 111);
await privText('6', 111);
t3 = (await bk.getTablesMerged()).find(t => t.id === 'T3');
ok('K4 мест: 6 (число, не кружочки)', t3.seatsCount === 6);

// Ручная бронь (админка, «звонок») — теперь тоже pending с кнопками
tgCalls.length = 0;
const rK = await bk.createReservation({
  tableId: 'T3', date: evening, timeFrom: slot, guestsCount: 2,
  guestName: 'Аня', guestPhone: '+79991112233', source: 'phone_manual',
  guestId: 'u_g1', createdByAdminId: 'u_admin',
});
await new Promise(r => setTimeout(r, 150));
ok('K5 ручная бронь НЕ автоподтверждена (pending)', res(rK.id).status === 'pending');
const staffK = [...calls('sendPhoto'), ...calls('sendMessage')].find(c => String(c.body.chat_id) === '-100500');
ok('K6 стафф-заявка: кнопки подтверждения + строка депозита',
  !!staffK && JSON.stringify(staffK.body.reply_markup || {}).includes(`stok:${rK.id}`)
  && (staffK.body.text || '').includes('Депозит: 1000'),
  JSON.stringify(staffK?.body || {}).slice(0, 400));

// Демо-оплата депозита: статус брони не меняется
await bk.payDeposit(rK.id);
ok('K7 депозит paid_mock, бронь осталась pending', res(rK.id).deposit_status === 'paid_mock' && res(rK.id).status === 'pending');
await bk.cancelReservation(rK.id, 'Тест завершён');

// Блокировка дат: конкретная дата и флаг «сегодня»
await bk.setBookingDatesConfig({ blockedDates: ['2026-12-30'] });
let dErr = '';
try { await bk.createReservation({ tableId: 'T6', date: '2026-12-30', timeFrom: '19:00', guestName: 'Аня', guestId: 'u_g1' }); } catch (e) { dErr = e.message; }
ok('K8 закрытая дата отбита сервером', dErr.includes('не принимаются'), dErr);
await bk.setBookingDatesConfig({ blockToday: true, blockedDates: [] });
dErr = '';
try { await bk.createReservation({ tableId: 'T6', date: evening, timeFrom: slot, guestName: 'Аня', guestId: 'u_g1' }); } catch (e) { dErr = e.message; }
ok('K9 флаг «сегодня» блокирует сегодняшнюю дату', dErr.includes('Сегодня'), dErr);
await bk.setBookingDatesConfig({ blockToday: false });

await cbPriv('bdates', 111);
const bdKb = calls('editMessageText').map(c => JSON.stringify(c.body.reply_markup || {})).join('');
ok('K10 экран «Даты брони»: переключатели и даты', bdKb.includes('bdtoday') && bdKb.includes('bdtomorrow') && bdKb.includes('bdt:'));
await cbPriv('bdtoday', 111);
ok('K11 тумблер «Сегодня» переключился', (await bk.getBookingDatesConfig()).blockToday === true);
await cbPriv('bdtoday', 111);
ok('K12 и обратно', (await bk.getBookingDatesConfig()).blockToday === false);

// ═══ L. Событие С ФОТО (мастер → шаг фото → альбом/одиночное) ═══
console.log('\n── L. Событие с фото ──');
const EV_DIR = process.env.EVENT_UPLOADS_DIR;
const diskPath = (url) => EV_DIR + '/' + String(url).replace('/uploads/events/', '');
const fileExists = async (p) => { try { await fsp.stat(p); return true; } catch { return false; } };

// L(3 фото → медиагруппа + анонс с кнопкой)
await cbPriv('ev', 111);
await cbPriv('evadd', 111);
await privText('Джем-сейшн с фото', 111);
await privText('15.11.2026', 111);
await privText('21:00', 111);
await privText('Три часа импровизаций', 111);
await privPhoto(111);
await privPhoto(111);
await privPhoto(111);
ok('L1 счётчик фото растёт (3/10)', calls('sendMessage').some(c => (c.body.text || '').includes('Фото 3/10')), JSON.stringify(calls('sendMessage').map(c => c.body.text)));
await cbPriv('evphotosundo', 111);
ok('L2 «Убрать последнее» → 2/10', calls('editMessageText').some(c => (c.body.text || '').includes('Фото 2/10')), JSON.stringify(calls('editMessageText').map(c => c.body.text)));
await privPhoto(111); // снова 3
await cbPriv('evphotosdone', 111);
ok('L3 превью — фото-сообщение с подписью «Проверьте»', calls('sendPhoto').some(c => (c.body.caption || c.body.text || '').includes('Проверьте событие')), JSON.stringify(calls('sendPhoto').map(c => c.body)).slice(0, 300));
await cbPriv('evsave', 111);
await new Promise(r => setTimeout(r, 250));
const evPhoto = db.t('events').find(e => e.title === 'Джем-сейшн с фото');
ok('L4 событие с 3 фото в БД (image_urls)', !!evPhoto && Array.isArray(evPhoto.image_urls) && evPhoto.image_urls.length === 3 && evPhoto.image_url === evPhoto.image_urls[0], JSON.stringify(evPhoto?.image_urls || null));
ok('L5 файлы webp сохранены на диске', !!evPhoto && await fileExists(diskPath(evPhoto.image_urls[0])) && await fileExists(diskPath(evPhoto.image_urls[0]).replace('.webp', '.thumb.webp')), diskPath(evPhoto?.image_urls?.[0] || ''));
ok('L6 в канал ушёл альбом (sendMediaGroup)', calls('sendMediaGroup').some(c => c.body.chat_id === '@catstest'), JSON.stringify(calls('sendMediaGroup').map(c => c.body.chat_id)));
const announce = calls('sendMessage').find(c => c.body.chat_id === '@catstest' && JSON.stringify(c.body.reply_markup || {}).includes('rsvp:'));
ok('L7 отдельный анонс с кнопкой «Я приду» (у медиагрупп кнопок нет)', !!announce, JSON.stringify(announce?.body || {}).slice(0, 250));
ok('L8 рассылка — пересылка анонса подписчикам', calls('forwardMessage').length >= 2 && calls('forwardMessage').every(c => String(c.body.from_chat_id) === '@catstest'), JSON.stringify(calls('forwardMessage').map(c => c.body)));

// L(1 фото → sendPhoto + подпись + кнопка прямо в канале)
await cbPriv('evadd', 111);
await privText('Вечер одного фото', 111);
await privText('16.11.2026', 111);
await privText('-', 111);
await privText('-', 111);
await privPhoto(111);
await cbPriv('evphotosdone', 111);
await cbPriv('evnotify', 111); // выключим рассылку — проверяем только канал
await cbPriv('evsave', 111);
await new Promise(r => setTimeout(r, 200));
const ev1 = db.t('events').find(e => e.title === 'Вечер одного фото');
ok('L9 событие с 1 фото в БД', !!ev1 && ev1.image_urls.length === 1);
const chPhoto = calls('sendPhoto').find(c => c.body.chat_id === '@catstest');
ok('L10 в канал — фото с подписью и кнопкой «Я приду»', !!chPhoto && (chPhoto.body.caption || chPhoto.body.text || '').includes('Вечер одного фото') && JSON.stringify(chPhoto.body.reply_markup || {}).includes('rsvp:'), JSON.stringify(chPhoto?.body || {}).slice(0, 250));

await fsp.rm(EV_DIR, { recursive: true, force: true }).catch(() => {}); // уборка временных фото

console.log(fails ? `\n${fails} FAILED` : '\nALL SCENARIOS PASS');
process.exit(fails ? 1 : 0);
