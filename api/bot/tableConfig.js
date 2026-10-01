import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { isTelegramStaff } from '../_lib/auth.js';
import {
  getTablesMerged, setTableDepositPrice, setTableSeatsCount,
  getBookingDatesConfig, setBookingDatesConfig,
} from '../_lib/booking.js';
import { activeSeats } from '../../src/booking/tablesConfig.js';
import { upcomingEveningDates } from '../../src/booking/barTime.js';
import { renderPlanPng } from '../_lib/planImage.js';
import { fmtEventDate, resetSession } from './helpers.js';

export const tableConfigComposer = new Composer();

const TC_CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'tblcfg');
const BD_CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'bdates');

// ─── Настройка столов ───────────────────────────────────────────────────────
async function tblcfgContent() {
  const tables = (await getTablesMerged()).filter(t => t.type !== 'bar');
  const kb = new InlineKeyboard();
  for (const t of tables) {
    const dep = t.depositPrice > 0 ? `${t.depositPrice} ₽` : 'без депозита';
    kb.text(`${t.zoneShort} №${t.num} · ${dep} · ${activeSeats(t)} мест`, `tccard:${t.id}`).row();
  }
  kb.text('‹ Админ-панель', 'adminmenu');
  return {
    text: '🪑 *Настройка столов*\n\nНажмите на стол — придёт карточка с планом зала, депозитом и числом мест.',
    kb,
  };
}

tableConfigComposer.callbackQuery('tblcfg', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  resetSession(ctx);
  const { text, kb } = await tblcfgContent();
  if (ctx.callbackQuery.message?.photo) {
    return ctx.reply(text, { reply_markup: kb, parse_mode: 'Markdown' });
  }
  return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
});

function tableCfgCaption(t) {
  return `🪑 *${t.zone}, №${t.num}*\n💰 Депозит: ${t.depositPrice > 0 ? t.depositPrice + ' ₽' : 'не нужен'}\n👥 Мест: ${activeSeats(t)}`;
}

function tableCfgKb(id) {
  return new InlineKeyboard()
    .text('💰 Изменить депозит', `tcdep:${id}`).row()
    .text('👥 Изменить места', `tcseats:${id}`).row()
    .text('‹ К столам', 'tblcfg');
}

tableConfigComposer.callbackQuery(/^tccard:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  const t = (await getTablesMerged()).find(x => x.id === ctx.match[1]);
  if (!t) return ctx.reply('Стол не найден.', { reply_markup: new InlineKeyboard().text('‹ К столам', 'tblcfg') });
  const opts = { caption: tableCfgCaption(t), reply_markup: tableCfgKb(t.id), parse_mode: 'Markdown' };
  try {
    const png = await renderPlanPng(t.id);
    return await ctx.replyWithPhoto(new InputFile(png, 'plan.png'), opts);
  } catch {
    return ctx.reply(opts.caption, { reply_markup: opts.reply_markup, parse_mode: 'Markdown' });
  }
});

tableConfigComposer.callbackQuery(/^tcdep:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  ctx.session.step = 'tc_deposit';
  ctx.session.draft = { tableId: ctx.match[1] };
  return ctx.reply('Введите сумму депозита в рублях (0 — без депозита):', { reply_markup: TC_CANCEL_KB });
});

tableConfigComposer.callbackQuery(/^tcseats:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  ctx.session.step = 'tc_seats';
  ctx.session.draft = { tableId: ctx.match[1] };
  return ctx.reply('Сколько мест доступно за этим столом? Введите число от 1 до 30:', { reply_markup: TC_CANCEL_KB });
});

// ─── Даты брони ─────────────────────────────────────────────────────────────
async function bdatesContent() {
  const cfg = await getBookingDatesConfig();
  const days = upcomingEveningDates(7);
  const kb = new InlineKeyboard();
  kb.text(`Кнопка «Сегодня»: ${cfg.blockToday ? '🚫 закрыта' : '✅ открыта'}`, 'bdtoday').row();
  kb.text(`Кнопка «Завтра»: ${cfg.blockTomorrow ? '🚫 закрыта' : '✅ открыта'}`, 'bdtomorrow').row();
  days.forEach((d, i) => {
    kb.text(`${cfg.blockedDates.includes(d) ? '🚫' : '✅'} ${fmtEventDate(d).slice(0, 5)}`, `bdt:${d}`);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  for (const d of cfg.blockedDates.filter(x => !days.includes(x))) {
    kb.text(`🚫 ${fmtEventDate(d)} — открыть`, `bdt:${d}`).row();
  }
  kb.text('✍️ Закрыть другую дату', 'bdadd').row();
  kb.text('‹ Админ-панель', 'adminmenu');
  const text = '📅 *Даты брони*\n\n'
    + 'Нажмите на дату, чтобы закрыть или открыть её для броней (🚫 — брони не принимаются).\n\n'
    + 'Переключатели «Сегодня»/«Завтра» блокируют сами кнопки на сайте и переезжают на новый день автоматически: закрытое «сегодня» и завтра останется закрытым, пока вы его не откроете.';
  return { text, kb };
}

async function renderBdates(ctx) {
  const { text, kb } = await bdatesContent();
  return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
}

tableConfigComposer.callbackQuery('bdates', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  resetSession(ctx);
  return renderBdates(ctx);
});

tableConfigComposer.callbackQuery(/^bd(today|tomorrow)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const key = ctx.match[1] === 'today' ? 'blockToday' : 'blockTomorrow';
  const cfg = await getBookingDatesConfig();
  const next = !cfg[key];
  await setBookingDatesConfig({ [key]: next });
  await ctx.answerCallbackQuery({ text: next ? 'Закрыто для брони' : 'Открыто для брони' });
  return renderBdates(ctx);
});

tableConfigComposer.callbackQuery(/^bdt:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const iso = ctx.match[1];
  const cfg = await getBookingDatesConfig();
  const wasBlocked = cfg.blockedDates.includes(iso);
  await setBookingDatesConfig({
    blockedDates: wasBlocked ? cfg.blockedDates.filter(d => d !== iso) : [...cfg.blockedDates, iso],
  });
  await ctx.answerCallbackQuery({ text: wasBlocked ? 'Дата открыта' : 'Дата закрыта' });
  return renderBdates(ctx);
});

tableConfigComposer.callbackQuery('bdadd', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  ctx.session.step = 'bd_date';
  ctx.session.draft = {};
  return ctx.reply(
    'Введите дату в формате ДД.ММ.ГГГГ — она закроется для брони (повторный ввод той же даты откроет её):',
    { reply_markup: BD_CANCEL_KB },
  );
});

// Текстовые шаги настройки столов и дат
tableConfigComposer.on('message:text', async (ctx, next) => {
  const step = ctx.session.step;
  if (!isTelegramStaff(ctx.from.id)) return next();
  if (!step || !['tc_deposit', 'tc_seats', 'bd_date'].includes(step)) return next();

  const text = ctx.message.text.trim();
  if (text === '/cancel') {
    resetSession(ctx);
    return ctx.reply('Отменено.', { reply_markup: new InlineKeyboard().text('‹ Админ-панель', 'adminmenu') });
  }

  if (step === 'tc_deposit' || step === 'tc_seats') {
    const tableId = ctx.session.draft.tableId;
    const table = (await getTablesMerged()).find(t => t.id === tableId);
    if (!table) {
      resetSession(ctx);
      return ctx.reply('Стол не найден, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Админ-панель', 'adminmenu') });
    }
    const label = `${table.zoneShort} №${table.num}`;
    const doneKb = new InlineKeyboard().text('🪑 К столам', 'tblcfg').text('🏠 Меню', 'adminmenu');
    if (step === 'tc_deposit') {
      const n = parseInt(text.replace(/\D/g, ''), 10);
      if (!Number.isFinite(n) || n < 0 || n > 1000000) {
        return ctx.reply('Введите сумму в рублях числом (0 — без депозита):', { reply_markup: TC_CANCEL_KB });
      }
      await setTableDepositPrice(tableId, n);
      resetSession(ctx);
      return ctx.reply(`Готово: ${label} — депозит ${n > 0 ? n + ' ₽' : 'не нужен'}.`, { reply_markup: doneKb });
    }
    const n = parseInt(text.replace(/\D/g, ''), 10);
    try {
      await setTableSeatsCount(tableId, n);
    } catch (e) {
      return ctx.reply(`${e.message}. Введите число мест:`, { reply_markup: TC_CANCEL_KB });
    }
    resetSession(ctx);
    return ctx.reply(`Готово: ${label} — ${n} мест.`, { reply_markup: doneKb });
  }

  if (step === 'bd_date') {
    const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    if (!iso || Number.isNaN(new Date(iso).getTime())) {
      return ctx.reply('Введите дату в формате ДД.ММ.ГГГГ, например 15.08.2026:', { reply_markup: BD_CANCEL_KB });
    }
    const cfg = await getBookingDatesConfig();
    const wasBlocked = cfg.blockedDates.includes(iso);
    await setBookingDatesConfig({
      blockedDates: wasBlocked ? cfg.blockedDates.filter(d => d !== iso) : [...cfg.blockedDates, iso],
    });
    resetSession(ctx);
    const { text: bdText, kb: bdKb } = await bdatesContent();
    await ctx.reply(wasBlocked ? `Дата ${text} снова открыта для брони.` : `Дата ${text} закрыта для брони.`);
    return ctx.reply(bdText, { reply_markup: bdKb, parse_mode: 'Markdown' });
  }

  return next();
});
