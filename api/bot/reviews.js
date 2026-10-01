import { Composer } from 'grammy';
import { ensureTelegramUser } from '../_lib/auth.js';
import { createReview, checkReviewCooldown } from '../_lib/reviews.js';

export const reviewsComposer = new Composer();

// ─── «Полка воспоминаний»: отзывы из Telegram-обсуждения ────────────────────
// Зарегистрировано через chatType(['group', 'supergroup']) ДО message:text
reviewsComposer.chatType(['group', 'supergroup']).on('message', async (ctx, next) => {
  if (String(ctx.chat.id) !== process.env.TELEGRAM_REVIEWS_CHAT_ID) return next();
  if (process.env.TELEGRAM_REVIEWS_THREAD_ID &&
      String(ctx.message.message_thread_id) !== process.env.TELEGRAM_REVIEWS_THREAD_ID) return;
  if (ctx.message.new_chat_members || ctx.message.left_chat_member || ctx.message.pinned_message) return;
  if (!ctx.message.text || ctx.message.text.trim().length < 10) return;
  if (ctx.from.is_bot) return;

  const user = await ensureTelegramUser(ctx.from);
  const telegramId = String(ctx.from.id);

  const cooldown = await checkReviewCooldown(telegramId);
  if (cooldown.blocked) {
    await ctx.deleteMessage().catch(() => {});
    const dateStr = cooldown.nextAllowedAt.toLocaleDateString('ru-RU');
    await ctx.api.sendMessage(ctx.from.id,
      `Спасибо за тёплые слова! 🎷 Следующее воспоминание можно оставить после ${dateStr} — раз в месяц, чтобы полка росла у всех гостей поровну.`,
    ).catch(() => {});
    return;
  }

  await createReview({
    author: user.name || ctx.from.first_name,
    text: ctx.message.text.trim(),
    rating: 5,
    source: 'telegram_group',
    telegram_id: telegramId,
    telegram_message_id: ctx.message.message_id,
  }).catch(() => {});
});
