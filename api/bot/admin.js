import { Composer } from 'grammy';
import { isTelegramStaff } from '../_lib/auth.js';
import { adminMenu, resetSession } from './helpers.js';

export const adminComposer = new Composer();

adminComposer.command('admin', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return;
  resetSession(ctx);
  return ctx.reply('🛠 *Админ-панель*', { reply_markup: adminMenu(), parse_mode: 'Markdown' });
});

adminComposer.callbackQuery('adminmenu', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isTelegramStaff(ctx.from.id)) return;
  resetSession(ctx);
  return ctx.editMessageText('🛠 *Админ-панель*', { reply_markup: adminMenu(), parse_mode: 'Markdown' }).catch(() => {});
});
