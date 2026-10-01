import { Composer, InlineKeyboard } from 'grammy';
import { isTelegramStaff } from '../_lib/auth.js';
import { getEvents, createEvent, updateEvent, deleteEvent } from '../_lib/events.js';
import { saveEventPhoto, deleteEventPhoto, MAX_PHOTOS } from '../_lib/eventPhotos.js';
import { sendBroadcast, forwardBroadcast } from '../_lib/broadcast.js';
import { broadcastAudit, registerTestRun, getTestRun, forgetTestRun, TEST_TTL_MS } from '../_lib/eventTestRun.js';
import { barEveningDate } from '../../src/booking/barTime.js';
import {
  CHANNEL, SITE_URL, escapeMd, fmtEventDate, eventBroadcastText,
  resetSession, genEventId, downloadTelegramFile, channelPostUrl,
} from './helpers.js';

export const eventsAndBroadcastComposer = new Composer();

const CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'evcancel');
const BC_CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'bccancel');

const eventsMenuKb = () => new InlineKeyboard()
  .text('➕ Создать событие', 'evadd').row()
  .text('📋 Ближайшие события', 'evlist').row()
  .text('🧪 Тестовый прогон', 'evtest').row()
  .text('‹ Назад', 'adminmenu');

function eventPhotoStepText(n) {
  return n === 0
    ? 'Пришлите фото события — до 10, можно альбомом.\n\n📷 Без фото событие опубликовать нельзя: оно идёт и в канал, и в витрину на сайте.'
    : `Фото ${n}/${MAX_PHOTOS} ✅. Пришлите ещё или нажмите «Готово».`;
}

function eventPhotoStepKb(n = 0) {
  const kb = new InlineKeyboard();
  if (n > 0) kb.text('✅ Готово', 'evphotosdone').row().text('🗑 Убрать последнее', 'evphotosundo').row();
  return kb.text('‹ Отмена', 'evcancel');
}

function eventPreviewContent(d) {
  const kb = new InlineKeyboard()
    .text(d.notify ? '🔔 Рассылка подписчикам: ДА' : '🔕 Рассылка подписчикам: НЕТ', 'evnotify').row()
    .text('✅ Опубликовать', 'evsave').row()
    .text('✏️ Начать заново', 'evadd').row()
    .text('‹ Отмена', 'evcancel');
  const notifyLine = d.notify
    ? '🔔 Подписчикам придёт пересланный пост из канала.'
    : '🔕 Без рассылки в личку — только сайт и канал.';
  const nPhotos = d.photos?.length || 0;
  const photoLine = nPhotos ? `\n🖼 Фото: ${nPhotos}` : '';
  const text = `Проверьте событие:\n\n*${escapeMd(d.title)}*\n📅 ${fmtEventDate(d.date)}${d.time ? ' в ' + d.time : ''}\n${escapeMd(d.description) || '(без описания)'}${photoLine}\n\n`
    + `После публикации: событие на сайте + пост в канале${CHANNEL ? ' ' + CHANNEL : ''}.\n${notifyLine}`;
  return { text, kb };
}

function sendEventPreview(ctx, d) {
  const { text, kb } = eventPreviewContent(d);
  if (d.photos?.length) {
    return ctx.replyWithPhoto(d.photos[0].fileId, { caption: text, parse_mode: 'Markdown', reply_markup: kb });
  }
  return ctx.reply(text, { reply_markup: kb, parse_mode: 'Markdown' });
}

function editPreviewMessage(ctx, text, kb) {
  const isPhoto = !!ctx.callbackQuery?.message?.photo;
  const p = isPhoto
    ? ctx.editMessageCaption({ caption: text, reply_markup: kb })
    : ctx.editMessageText(text, { reply_markup: kb });
  return p.catch(() => ctx.reply(text, { reply_markup: kb }));
}

// ─── События в админ-панели ────────────────────────────────────────────────
eventsAndBroadcastComposer.callbackQuery('ev', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isTelegramStaff(ctx.from.id)) return;
  resetSession(ctx);
  return ctx.editMessageText(
    '📢 *События*\n\nНовое событие появится на сайте (страница «Афиша») и постом в канале. Рассылку подписчикам можно включить или выключить перед публикацией.',
    { reply_markup: eventsMenuKb(), parse_mode: 'Markdown' },
  );
});

eventsAndBroadcastComposer.callbackQuery('evcancel', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Отменено' });
  if (!isTelegramStaff(ctx.from.id)) return;
  resetSession(ctx);
  return ctx.editMessageText('📢 *События*\n\nВыберите действие:', { reply_markup: eventsMenuKb(), parse_mode: 'Markdown' }).catch(() => {});
});

eventsAndBroadcastComposer.callbackQuery('evadd', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isTelegramStaff(ctx.from.id)) return;
  ctx.session.step = 'ev_title';
  ctx.session.draft = {};
  return ctx.editMessageText('Введите название события:', { reply_markup: CANCEL_KB });
});

eventsAndBroadcastComposer.callbackQuery('evlist', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isTelegramStaff(ctx.from.id)) return;
  const events = await getEvents({ upcomingOnly: true });
  const top = events.slice(0, 5);
  if (!top.length) {
    return ctx.editMessageText('Ближайших событий нет.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
  }
  const kb = new InlineKeyboard();
  const lines = top.map(e => `• ${escapeMd(e.title)} — ${fmtEventDate(e.date)}${e.time ? ' ' + e.time : ''}`);
  top.forEach(e => kb.text(`📢 Напомнить: ${e.title}`, `evre:${e.id}`).row());
  kb.text('‹ Назад', 'ev');
  return ctx.editMessageText(`📋 *Ближайшие события:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
});

eventsAndBroadcastComposer.callbackQuery(/^evre:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery({ text: 'Рассылаю...' });
  const events = await getEvents({ upcomingOnly: true });
  const found = events.find(e => e.id === ctx.match[1]);
  if (!found) return ctx.editMessageText('Событие не найдено.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
  const rsvpKb = new InlineKeyboard().text('🙋 Я приду', `rsvp:${found.id}`);
  const { total, sent, blocked } = await sendBroadcast(ctx.api, eventBroadcastText(found, true), { replyMarkup: rsvpKb });
  return ctx.editMessageText(
    `✅ Напоминание отправлено.\nПолучателей: ${total}, доставлено: ${sent}${blocked ? `, недоступно: ${blocked}` : ''}.`,
    { reply_markup: new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu') },
  );
});

eventsAndBroadcastComposer.callbackQuery('evnotify', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const d = ctx.session.draft;
  if (!d?.title || !d?.date) {
    await ctx.answerCallbackQuery();
    resetSession(ctx);
    return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
  }
  d.notify = !d.notify;
  await ctx.answerCallbackQuery({ text: d.notify ? 'Рассылка включена' : 'Рассылка выключена' });
  const { text, kb } = eventPreviewContent(d);
  const isPhoto = !!ctx.callbackQuery.message?.photo;
  const edit = isPhoto
    ? ctx.editMessageCaption({ caption: text, parse_mode: 'Markdown', reply_markup: kb })
    : ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' });
  return edit.catch(() => {});
});

eventsAndBroadcastComposer.callbackQuery('evsave', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery({ text: 'Публикую...' });
  const d = ctx.session.draft;
  if (!d?.title || !d?.date) {
    resetSession(ctx);
    return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
  }
  if (!d.photos?.length) {
    return editPreviewMessage(ctx, '📷 Без фото событие опубликовать нельзя — пришлите хотя бы одно.', eventPhotoStepKb(0));
  }
  try {
    const photos = d.photos || [];
    const ev = await createEvent({
      id: d.eventId, title: d.title, date: d.date, time: d.time, description: d.description,
      imageUrls: photos.map(p => p.url),
    });
    const notify = !!d.notify;
    resetSession(ctx);
    const report = ['✅ Событие сохранено — уже видно на сайте (страница «Афиша»).'];

    const caption = eventBroadcastText(ev, false);
    const rsvpKb = () => new InlineKeyboard().text('🙋 Я приду', `rsvp:${ev.id}`);
    let channelMsg = null;
    let broadcastMsg = null;
    if (CHANNEL) {
      const onErr = (e) => { console.error('[bot] channel post failed:', e.message); return null; };
      if (photos.length === 0) {
        channelMsg = await ctx.api.sendMessage(CHANNEL, caption, { parse_mode: 'Markdown', reply_markup: rsvpKb() }).catch(onErr);
        broadcastMsg = channelMsg;
      } else if (photos.length === 1) {
        channelMsg = await ctx.api.sendPhoto(CHANNEL, photos[0].fileId, { caption, parse_mode: 'Markdown', reply_markup: rsvpKb() }).catch(onErr);
        broadcastMsg = channelMsg;
      } else {
        const media = photos.slice(0, MAX_PHOTOS).map((p, i) => (
          i === 0 ? { type: 'photo', media: p.fileId, caption, parse_mode: 'Markdown' } : { type: 'photo', media: p.fileId }
        ));
        const groupMsgs = await ctx.api.sendMediaGroup(CHANNEL, media).catch(onErr);
        channelMsg = Array.isArray(groupMsgs) ? groupMsgs[0] : null;
        broadcastMsg = await ctx.api.sendMessage(CHANNEL, `🎷 *${escapeMd(ev.title)}* — подробности и «Я приду» 👇`, { parse_mode: 'Markdown', reply_markup: rsvpKb() }).catch(onErr);
      }
      report.push(channelMsg
        ? `📢 Пост опубликован в канале ${CHANNEL}${photos.length ? ` (${photos.length} фото)` : ''}.`
        : `⚠️ Пост в канал ${CHANNEL} не ушёл — проверьте, что бот админ канала.`);

      const postUrl = channelPostUrl(channelMsg?.message_id);
      if (postUrl) {
        await updateEvent(ev.id, { channelPostUrl: postUrl })
          .catch((e) => console.error('[bot] channel_post_url save failed:', e.message));
      }
    }

    if (notify) {
      let stats;
      if (broadcastMsg) {
        stats = await forwardBroadcast(ctx.api, broadcastMsg.chat.id, broadcastMsg.message_id);
      } else {
        stats = await sendBroadcast(ctx.api, caption, { replyMarkup: rsvpKb() });
      }
      report.push(`📨 Уведомление подписчикам: доставлено ${stats.sent} из ${stats.total}${stats.blocked ? `, бот заблокирован у ${stats.blocked}` : ''}.`);
    }

    const doneKb = new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu');
    return editPreviewMessage(ctx, report.join('\n'), doneKb);
  } catch (e) {
    return editPreviewMessage(ctx, `Не удалось сохранить: ${e.message}`, new InlineKeyboard().text('‹ Назад', 'ev'));
  }
});

// Загрузка фото в мастере события
eventsAndBroadcastComposer.on('message:photo', async (ctx, next) => {
  if (ctx.session.step !== 'ev_photos') return next();
  if (!isTelegramStaff(ctx.from.id)) return;
  const d = ctx.session.draft;
  d.photos = d.photos || [];
  if (!d.eventId) d.eventId = genEventId();
  if (d.photos.length >= MAX_PHOTOS) {
    return ctx.reply(`Уже ${MAX_PHOTOS} фото — это максимум. Нажмите «Готово».`, { reply_markup: eventPhotoStepKb(d.photos.length) });
  }
  try {
    const sizes = ctx.message.photo;
    const largest = sizes[sizes.length - 1];
    const buffer = await downloadTelegramFile(ctx.api, largest.file_id);
    const saved = await saveEventPhoto(d.eventId, buffer);
    d.photos.push({ url: saved.url, fileId: largest.file_id });
  } catch (e) {
    console.error('[bot] event photo save failed:', e.message);
    return ctx.reply('Не смог скачать/сохранить фото, пришлите ещё раз.', { reply_markup: eventPhotoStepKb(d.photos.length) });
  }
  return ctx.reply(eventPhotoStepText(d.photos.length), { reply_markup: eventPhotoStepKb(d.photos.length) });
});

eventsAndBroadcastComposer.callbackQuery('evphotosdone', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery();
  const d = ctx.session.draft;
  if (!d?.photos?.length) {
    return ctx.answerCallbackQuery({ text: 'Сначала пришлите хотя бы одно фото — без него событие не публикуется.', show_alert: true });
  }
  await ctx.answerCallbackQuery();
  if (!d?.title || !d?.date) {
    resetSession(ctx);
    return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') }).catch(() => {});
  }
  d.notify = true;
  ctx.session.step = null;
  return sendEventPreview(ctx, d);
});

eventsAndBroadcastComposer.callbackQuery('evphotosundo', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery();
  const d = ctx.session.draft;
  if (d?.photos?.length) {
    const removed = d.photos.pop();
    await deleteEventPhoto(d.eventId, removed.url).catch(() => {});
    await ctx.answerCallbackQuery({ text: 'Убрал последнее фото' });
  } else {
    await ctx.answerCallbackQuery();
  }
  const n = d?.photos?.length || 0;
  return ctx.editMessageText(eventPhotoStepText(n), { reply_markup: eventPhotoStepKb(n) })
    .catch(() => ctx.reply(eventPhotoStepText(n), { reply_markup: eventPhotoStepKb(n) }));
});

// ─── Тестовый прогон афиши ─────────────────────────────────────────────────
const TEST_PHOTO = `${SITE_URL}/uploads/team/live-music.jpg`;

function testReportKb(eventId, url) {
  const kb = new InlineKeyboard();
  if (url) kb.url('Открыть пост', url).row();
  return kb.text('🗑 Удалить сейчас', `evtestdel:${eventId}`).row().text('‹ К событиям', 'ev');
}

async function cleanupTestRun(api, eventId, reason) {
  const run = getTestRun(eventId);
  if (!run) return null;
  forgetTestRun(eventId);
  if (run.timer) clearTimeout(run.timer);
  const errors = [];
  for (const mid of run.channelMessageIds || []) {
    await api.deleteMessage(CHANNEL, mid).catch((e) => errors.push(`пост ${mid}: ${e.message}`));
  }
  await deleteEvent(eventId).catch((e) => errors.push(`событие: ${e.message}`));

  const done = errors.length
    ? `🧪 Тестовый прогон убран частично (${reason}).\n⚠️ ${errors.join('; ')}`
    : `🧪 Тестовый прогон завершён (${reason}).\nПост удалён из канала, событие снято с сайта.`;
  if (run.reportChatId && run.reportMessageId) {
    await api.editMessageText(run.reportChatId, run.reportMessageId, done, {
      reply_markup: new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu'),
    }).catch(() => {});
  }
  return { errors };
}

eventsAndBroadcastComposer.callbackQuery('evtest', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery({ text: 'Запускаю прогон…' });
  resetSession(ctx);
  if (!CHANNEL) {
    return ctx.editMessageText('Канал не настроен (TELEGRAM_CHANNEL) — прогонять нечего.',
      { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
  }

  const stamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  let ev;
  try {
    ev = await createEvent({
      title: `Технический прогон ${stamp}`,
      date: barEveningDate(),
      time: '',
      description: 'Проверка публикации афиши. Событие и пост удалятся автоматически через 30 секунд.',
      imageUrls: [TEST_PHOTO],
    });
  } catch (e) {
    return ctx.editMessageText(`Не удалось создать тестовое событие: ${e.message}`,
      { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
  }

  const caption = `🧪 *ТЕСТ*\n\n${eventBroadcastText(ev, false)}\n\n_Служебный пост, удалится через 30 секунд._`;
  const channelMsg = await ctx.api
    .sendPhoto(CHANNEL, TEST_PHOTO, { caption, parse_mode: 'Markdown' })
    .catch((e) => { console.error('[bot] test channel post failed:', e.message); return null; });

  let audit = null;
  try { audit = await broadcastAudit(); } catch (e) { console.error('[bot] audit failed:', e.message); }
  let forwarded = 0;
  if (channelMsg) {
    const adminIds = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const staffIds = new Set([String(ctx.from.id), ...adminIds]);
    for (const id of staffIds) {
      const ok = await ctx.api.forwardMessage(id, channelMsg.chat.id, channelMsg.message_id)
        .then(() => true).catch(() => false);
      if (ok) forwarded += 1;
    }
  }

  const lines = [
    '🧪 *Тестовый прогон*',
    '',
    channelMsg ? `📢 Пост в канале ${CHANNEL} — опубликован.` : `⚠️ Пост в канал ${CHANNEL} не ушёл: бот не админ канала?`,
    `🌐 Событие на сайте: ${SITE_URL}/#events (обновите страницу).`,
  ];
  if (audit) {
    lines.push(
      '',
      '📨 *Рассылка (только подсчёт, никому не отправлено):*',
      `• аккаунтов всего: ${audit.accounts}`,
      `• связаны с телеграмом: ${audit.withTelegram}`,
      `• получили бы пост: ${audit.reachable}`,
      `• заблокировали бота: ${audit.blocked}`,
      `• регистрировались на сайте без телеграма: ${audit.siteOnly} (им бот написать не может)`,
    );
  } else {
    lines.push('', '⚠️ Не удалось посчитать аудиторию рассылки — смотрите логи API.');
  }
  lines.push('', `↩️ Пересылка проверена на администраторах: доставлено ${forwarded}.`);
  lines.push('', '⏳ Через 30 секунд пост и событие удалятся сами.');

  const url = channelPostUrl(channelMsg?.message_id);
  const report = await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: testReportKb(ev.id, url),
  }).catch(() => null);

  const run = registerTestRun({
    eventId: ev.id,
    channelMessageIds: channelMsg ? [channelMsg.message_id] : [],
    reportChatId: report?.chat?.id || ctx.chat?.id,
    reportMessageId: report?.message_id || ctx.callbackQuery?.message?.message_id,
    timer: null,
  });
  run.timer = setTimeout(() => {
    cleanupTestRun(ctx.api, ev.id, 'по таймеру').catch((e) => console.error('[bot] test cleanup failed:', e.message));
  }, TEST_TTL_MS);
  if (typeof run.timer.unref === 'function') run.timer.unref();
  return report;
});

eventsAndBroadcastComposer.callbackQuery(/^evtestdel:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const eventId = ctx.match[1];
  if (!getTestRun(eventId)) {
    await ctx.answerCallbackQuery({ text: 'Уже удалено' });
    return ctx.editMessageText('🧪 Тестовый прогон уже убран.',
      { reply_markup: new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu') }).catch(() => {});
  }
  await ctx.answerCallbackQuery({ text: 'Убираю…' });
  return cleanupTestRun(ctx.api, eventId, 'вручную');
});

// ─── Рассылка (bc) ─────────────────────────────────────────────────────────
eventsAndBroadcastComposer.callbackQuery('bc', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  ctx.session.step = 'bc_text';
  ctx.session.draft = {};
  return ctx.editMessageText(
    '📨 *Рассылка*\n\nНапишите текст одним сообщением — он уйдёт в личку всем гостям, кто запускал бота. Перед отправкой покажу превью.',
    { reply_markup: BC_CANCEL_KB, parse_mode: 'Markdown' },
  );
});

eventsAndBroadcastComposer.callbackQuery('bccancel', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Отменено' });
  if (!isTelegramStaff(ctx.from.id)) return;
  resetSession(ctx);
  return ctx.editMessageText('🛠 *Админ-панель*', { reply_markup: new InlineKeyboard().text('‹ Назад', 'adminmenu'), parse_mode: 'Markdown' }).catch(() => {});
});

eventsAndBroadcastComposer.callbackQuery('bcsend', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const d = ctx.session.draft;
  if (!d?.broadcastText) {
    await ctx.answerCallbackQuery();
    resetSession(ctx);
    return ctx.editMessageText('Текст рассылки утерян, начните заново.', {
      reply_markup: new InlineKeyboard().text('📨 Рассылка', 'bc').text('🏠 Меню', 'adminmenu'),
    });
  }
  await ctx.answerCallbackQuery({ text: 'Рассылаю...' });
  const textToSend = d.broadcastText;
  resetSession(ctx);
  const { total, sent, blocked } = await sendBroadcast(ctx.api, textToSend, { parseMode: null });
  return ctx.editMessageText(
    `✅ Рассылка отправлена.\nПолучателей: ${total}, доставлено: ${sent}${blocked ? `, бот заблокирован у ${blocked}` : ''}.`,
    { reply_markup: new InlineKeyboard().text('🏠 Меню', 'adminmenu') },
  );
});

// Текстовые шаги событий и рассылки
eventsAndBroadcastComposer.on('message:text', async (ctx, next) => {
  const step = ctx.session.step;
  if (!isTelegramStaff(ctx.from.id)) return next();
  if (!step || !['bc_text', 'ev_title', 'ev_date', 'ev_time', 'ev_desc'].includes(step)) return next();

  const text = ctx.message.text.trim();
  if (text === '/cancel') {
    resetSession(ctx);
    return ctx.reply('Отменено.', { reply_markup: new InlineKeyboard().text('‹ Админ-панель', 'adminmenu') });
  }

  if (step === 'bc_text') {
    ctx.session.draft.broadcastText = text.slice(0, 3500);
    ctx.session.step = null;
    const kb = new InlineKeyboard()
      .text('✅ Разослать', 'bcsend').row()
      .text('✏️ Изменить текст', 'bc').row()
      .text('‹ Отмена', 'bccancel');
    return ctx.reply(`Гости получат это сообщение:\n\n${ctx.session.draft.broadcastText}\n\nОтправляем?`, { reply_markup: kb });
  }

  if (step === 'ev_title') {
    if (!text) return ctx.reply('Название не может быть пустым. Введите название события:', { reply_markup: CANCEL_KB });
    ctx.session.draft.title = text;
    ctx.session.step = 'ev_date';
    return ctx.reply('Введите дату в формате ДД.ММ.ГГГГ (например 15.08.2026):', { reply_markup: CANCEL_KB });
  }

  if (step === 'ev_date') {
    const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    if (!iso || Number.isNaN(new Date(iso).getTime())) {
      return ctx.reply('Не получилось распознать дату. Введите в формате ДД.ММ.ГГГГ, например 15.08.2026:', { reply_markup: CANCEL_KB });
    }
    ctx.session.draft.date = iso;
    ctx.session.step = 'ev_time';
    return ctx.reply('Введите время начала, например 20:00 (или «-», если без фиксированного времени):', { reply_markup: CANCEL_KB });
  }

  if (step === 'ev_time') {
    if (text !== '-' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
      return ctx.reply('Введите время в формате ЧЧ:ММ (например 20:00) или «-»:', { reply_markup: CANCEL_KB });
    }
    ctx.session.draft.time = text === '-' ? '' : text;
    ctx.session.step = 'ev_desc';
    return ctx.reply('Коротко опишите событие (2–3 предложения) или отправьте «-», чтобы пропустить:', { reply_markup: CANCEL_KB });
  }

  if (step === 'ev_desc') {
    ctx.session.draft.description = text === '-' ? '' : text;
    ctx.session.draft.eventId = ctx.session.draft.eventId || genEventId();
    ctx.session.draft.photos = ctx.session.draft.photos || [];
    ctx.session.step = 'ev_photos';
    return ctx.reply(eventPhotoStepText(0), { reply_markup: eventPhotoStepKb(0) });
  }

  return next();
});
