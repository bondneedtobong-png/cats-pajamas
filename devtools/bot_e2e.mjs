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
delete process.env.TELEGRAM_CHANNEL; // isSubscribed → true, гейт не мешает

// ── Перехват Telegram API ──
const tgCalls = [];
let tgMsgId = 1000;
function tgIntercept(url, opts) {
  const s = String(url);
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
  if (method === 'sendMessage') result = { message_id: ++tgMsgId, chat: { id: body.chat_id }, date: 0, text: body.text || '' };
  if (method === 'sendPhoto') result = { message_id: ++tgMsgId, chat: { id: body.chat_id }, date: 0 };
  if (method === 'editMessageText') result = { message_id: body.message_id, chat: { id: body.chat_id }, date: 0, text: body.text || '' };
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
const calls = (m) => tgCalls.filter(c => c.method === m);
const res = (id) => db.t('reservations').find(r => r.id === id);
const guestPoints = (uid) => db.t('users').find(u => u.id === uid).loyalty_points;
const openOcc = (tableId) => db.t('table_occupancy').find(o => o.table_id === tableId && o.freed_at == null);

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
const ptsAfter = guestPoints('u_g1');
ok('A16 баллы начислены', ptsAfter > 0, 'points=' + ptsAfter);
await cb(`tbldone:${rA.id}`, 555); // повторно
ok('A17 повторное «Гости ушли» → отказ, баллы не задвоились', guestPoints('u_g1') === ptsAfter);
ok('A18 транзакция visit ровно одна', db.t('loyalty_transactions').filter(t => t.source_type === 'visit' && t.source_id === rA.id).length === 1);

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
ok('D6 баллы за walk-in не начислялись', db.t('loyalty_transactions').filter(t => t.source_type === 'visit').length === 1);

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
const ptsBeforeF = guestPoints(res(rE.id).guest_id);
await cb(`tblno:${rE.id}`, 555);
ok('F2 «Не пришли» → no_show', res(rE.id).status === 'no_show');
ok('F3 occupancy закрыта, стол свободен', !openOcc('T4'));
ok('F4 баллов нет', guestPoints(res(rE.id).guest_id) === ptsBeforeF);

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

// ═══ H. Старый пошаговый флоу бота уважает правило вечера ═══
console.log('\n── H. Пошаговый флоу ──');
const rH = await bk.createReservation({ tableId: 'T1', date: evening, timeFrom: slot, guestName: 'Аня', guestId: 'u_g1' }); // T1 занят заявкой
await new Promise(r => setTimeout(r, 120));
await bot.handleUpdate({
  update_id: updId++,
  callback_query: {
    id: 'cbq' + updId, chat_instance: 'ci',
    from: { id: 424242, is_bot: false, first_name: 'Аня' },
    message: { message_id: 5, date: 0, text: 'x', chat: { id: 424242, type: 'private' } },
    data: `bkt:${evening}:${slot}`,
  },
});
const kbH = [...calls('editMessageCaption'), ...calls('editMessageText')].map(c => JSON.stringify(c.body.reply_markup || {})).join('');
ok('H1 занятый стол не предлагается', !kbH.includes(':T1') && kbH.includes(':T5'), kbH.slice(0, 200));
tgCalls.length = 0;
await bot.handleUpdate({
  update_id: updId++,
  callback_query: {
    id: 'cbq' + updId, chat_instance: 'ci',
    from: { id: 424242, is_bot: false, first_name: 'Аня' },
    message: { message_id: 5, date: 0, text: 'x', chat: { id: 424242, type: 'private' } },
    data: `bkok:${evening}:${slot}:T5`,
  },
});
await new Promise(r => setTimeout(r, 120));
const rBot = db.t('reservations').find(r => r.table_id === 'T5' && r.source === 'telegram_bot');
ok('H2 бот-заявка создана как pending', rBot?.status === 'pending');
ok('H3 гостю «Заявка отправлена», не «подтверждена»', [...calls('editMessageCaption'), ...calls('editMessageText')].some(c => (c.body.text || '').includes('Заявка отправлена')));
ok('H4 стафф-уведомление по бот-заявке ушло', [...calls('sendPhoto'), ...calls('sendMessage')].some(c => String(c.body.chat_id) === '-100500' && JSON.stringify(c.body.reply_markup || {}).includes('stok:')));

console.log(fails ? `\n${fails} FAILED` : '\nALL SCENARIOS PASS');
process.exit(fails ? 1 : 0);
