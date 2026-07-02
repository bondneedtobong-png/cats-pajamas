import { supabase } from './supabase.js';

// Server-side reviews logic. Two sources: manual entry via admin (no Yandex
// API available — TODO: swap for a real Yandex Maps sync if/when they offer
// one) and 'telegram_group' — guests write a review as a plain text message
// in the Telegram discussion group, api/bot.js turns it into a row here.

const REVIEW_COOLDOWN_DAYS = 30;

function generateId() { return 'rv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function rowToReview(r) {
  return {
    id: r.id,
    author: r.author,
    rating: r.rating,
    text: r.text || '',
    date: r.review_date,
    source: r.source,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Public: active + rating>=4 (hard rule, not admin-toggleable), newest first.
 * Admin: everything, newest first.
 */
export async function getReviews({ publicOnly = true } = {}) {
  let q = supabase.from('reviews').select('*').order('review_date', { ascending: false });
  if (publicOnly) q = q.eq('active', true).gte('rating', 4);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(rowToReview);
}

export async function createReview(input) {
  if (!input.author?.trim()) throw new Error('Имя автора обязательно');

  const row = {
    id: generateId(),
    author: input.author.trim(),
    rating: Math.min(5, Math.max(1, parseInt(input.rating) || 5)),
    text: input.text?.trim() || '',
    // Админ всегда указывает дату вручную; для Telegram-отзывов даты нет —
    // используем момент прихода сообщения.
    review_date: input.date || new Date().toISOString().split('T')[0],
    source: input.source || 'manual',
    telegram_id: input.telegram_id || null,
    telegram_message_id: input.telegram_message_id != null ? String(input.telegram_message_id) : null,
    active: input.active !== false,
  };
  const { data, error } = await supabase.from('reviews').insert(row).select().single();
  if (error) {
    // Повторная доставка того же вебхука Telegram — не считать ошибкой.
    if (error.code === '23505') throw new Error('DUPLICATE_REVIEW');
    throw new Error(error.message);
  }
  return rowToReview(data);
}

/** Антиспам-каденция: одно воспоминание из Telegram раз в REVIEW_COOLDOWN_DAYS на гостя. */
export async function checkReviewCooldown(telegramId) {
  const { data } = await supabase
    .from('reviews')
    .select('created_at')
    .eq('telegram_id', telegramId)
    .eq('source', 'telegram_group')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { blocked: false };

  const nextAllowedAt = new Date(data.created_at);
  nextAllowedAt.setDate(nextAllowedAt.getDate() + REVIEW_COOLDOWN_DAYS);
  return { blocked: nextAllowedAt > new Date(), nextAllowedAt };
}

export async function updateReview(id, input) {
  const patch = {};
  if ('author' in input) patch.author      = input.author?.trim() || '';
  if ('rating' in input) patch.rating      = Math.min(5, Math.max(1, parseInt(input.rating) || 5));
  if ('text' in input)   patch.text        = input.text?.trim() || '';
  if ('date' in input)   patch.review_date = input.date;
  if ('active' in input) patch.active      = !!input.active;

  const { data, error } = await supabase.from('reviews').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Отзыв не найден');
  return rowToReview(data);
}

export async function deleteReview(id) {
  const { error } = await supabase.from('reviews').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
