import { supabase } from './supabase.js';

// Программа лояльности + ежедневное колесо + каталог наград. Полная история
// начислений/списаний — в loyalty_transactions (единый журнал для визитов,
// колеса и обменов на награды, читается и сайтом, и админкой). Баллы
// начисляются, когда бронь переходит в статус 'completed', и за подтверждённую
// явку на события (см. awardAttendancePoints, вызывается из
// booking.js/updateReservationStatus и eventRsvps.js/confirmRsvp).

const LOYALTY_RULES_KEY = 'loyalty_rules';

export const TIERS = [
  { key: 'kitten',  label: '🐾 Котёнок',             min: 0 },
  { key: 'jazzcat', label: '🐱 Кот джаза',            min: 50 },
  { key: 'oldpaw',  label: '🐈‍⬛ Мурлыка-старожил', min: 150 },
  { key: 'boss',    label: '👑 Хозяин клуба',          min: 350 },
];

// Пул призов колеса на каждый уровень — чем выше уровень, тем меньше шанс
// "пустого" результата и тем ценнее призы. redeem:true — приз, который
// бармен должен выдать физически на месте (гость показывает сообщение бота).
const PRIZE_POOLS = {
  kitten: [
    { code: 'miss',  label: 'Не повезло — попробуйте завтра! 😿', weight: 45, points: 0, redeem: false },
    { code: 'pts5',  label: '+5 бонусных баллов',                  weight: 25, points: 5, redeem: false },
    { code: 'snack', label: 'Комплимент от бара — снек к напитку', weight: 20, points: 0, redeem: true },
    { code: 'disc5', label: 'Скидка 5% на счёт',                   weight: 10, points: 0, redeem: true },
  ],
  jazzcat: [
    { code: 'miss',    label: 'Не повезло — попробуйте завтра! 😿', weight: 25, points: 0, redeem: false },
    { code: 'pts10',   label: '+10 бонусных баллов',                 weight: 25, points: 10, redeem: false },
    { code: 'disc5',   label: 'Скидка 5% на счёт',                   weight: 25, points: 0, redeem: true },
    { code: 'disc10',  label: 'Скидка 10% на счёт',                  weight: 15, points: 0, redeem: true },
    { code: 'dessert', label: 'Десерт в подарок',                    weight: 10, points: 0, redeem: true },
  ],
  oldpaw: [
    { code: 'pts15',    label: '+15 бонусных баллов',            weight: 20, points: 15, redeem: false },
    { code: 'disc10',   label: 'Скидка 10% на счёт',             weight: 25, points: 0, redeem: true },
    { code: 'disc15',   label: 'Скидка 15% на счёт',             weight: 20, points: 0, redeem: true },
    { code: 'dessert',  label: 'Десерт в подарок',               weight: 20, points: 0, redeem: true },
    { code: 'cocktail', label: 'Фирменный коктейль в подарок',   weight: 15, points: 0, redeem: true },
  ],
  boss: [
    { code: 'disc15',    label: 'Скидка 15% на счёт',                        weight: 25, points: 0, redeem: true },
    { code: 'disc20',    label: 'Скидка 20% на счёт',                        weight: 20, points: 0, redeem: true },
    { code: 'cocktail',  label: 'Фирменный коктейль в подарок',              weight: 25, points: 0, redeem: true },
    { code: 'nodeposit', label: 'Столик без депозита при следующей брони',   weight: 15, points: 0, redeem: true },
    { code: 'pts40',     label: '+40 бонусных баллов',                       weight: 15, points: 40, redeem: false },
  ],
};

const DEFAULT_RULES = {
  visitPoints: 10,
  attendancePoints: { kitten: 10, jazzcat: 15, oldpaw: 20, boss: 30 },
};

function genSpinId()       { return 'ws_'  + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function genTxId()         { return 'lt_'  + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function genRewardId()     { return 'lr_'  + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function genRedemptionId() { return 'lrd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function todayIso() { return new Date().toISOString().split('T')[0]; }

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function genCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export function tierForPoints(points) {
  let cur = TIERS[0];
  for (const t of TIERS) if (points >= t.min) cur = t;
  return cur;
}

export function nextTier(points) {
  return TIERS.find(t => t.min > points) || null;
}

function tierMeets(guestTierKey, requiredTierKey) {
  if (!requiredTierKey) return true;
  const guestMin = TIERS.find(t => t.key === guestTierKey)?.min ?? 0;
  const reqMin = TIERS.find(t => t.key === requiredTierKey)?.min ?? 0;
  return guestMin >= reqMin;
}

// Правила начисления читаются из app_config (ключ loyalty_rules) с фолбэком на
// дефолты выше, если админ ещё ничего не настраивал — сайт/бот никогда не
// падают из-за отсутствующего конфига. Расширяемо: новые правила добавляются
// как новые ключи объекта, старый код просто их не читает.
export async function getLoyaltyRules() {
  const { data } = await supabase.from('app_config').select('value').eq('key', LOYALTY_RULES_KEY).maybeSingle();
  const rules = data?.value || {};
  return {
    visitPoints: rules.visitPoints ?? DEFAULT_RULES.visitPoints,
    attendancePoints: { ...DEFAULT_RULES.attendancePoints, ...(rules.attendancePoints || {}) },
  };
}

export async function setLoyaltyRules(rules) {
  await supabase.from('app_config').upsert({ key: LOYALTY_RULES_KEY, value: rules });
}

// Единый журнал операций — читается вкладкой «Уровень» на сайте и админкой,
// независимо от источника изменения баллов. Best-effort (не бросает) — запись
// в историю не должна ронять уже совершённое начисление/списание.
async function recordTransaction(userId, delta, reason, sourceType, sourceId, balanceAfter) {
  await supabase.from('loyalty_transactions').insert({
    id: genTxId(), user_id: userId, delta, reason, source_type: sourceType,
    source_id: sourceId ?? null, balance_after: balanceAfter,
  });
}

/** Best-effort — не бросает, вызывающий код (booking.js, eventRsvps.js) не
 *  должен падать, если начисление не удалось. Защита от повторного начисления
 *  — на уровне вызывающего кода (guard терминальных статусов), не здесь. */
export async function awardAttendancePoints(guestId, { sourceId = null, reason = 'Визит подтверждён' } = {}) {
  if (!guestId) return;
  const { data: user } = await supabase.from('users').select('id, loyalty_points').eq('id', guestId).maybeSingle();
  if (!user) return;
  const rules = await getLoyaltyRules();
  const points = user.loyalty_points || 0;
  const amount = rules.attendancePoints[tierForPoints(points).key] ?? rules.visitPoints;
  const balanceAfter = points + amount;
  await supabase.from('users').update({ loyalty_points: balanceAfter }).eq('id', guestId);
  await recordTransaction(guestId, amount, reason, 'visit', sourceId, balanceAfter).catch(() => {});
}

export async function getLoyaltyStatus(guestId) {
  const { data: user, error } = await supabase.from('users').select('id, loyalty_points').eq('id', guestId).maybeSingle();
  if (error || !user) throw new Error('Пользователь не найден');
  const points = user.loyalty_points || 0;
  return { points, tier: tierForPoints(points), next: nextTier(points) };
}

export async function getTodaySpin(guestId) {
  const { data } = await supabase.from('wheel_spins').select('*')
    .eq('guest_id', guestId).eq('spin_date', todayIso()).maybeSingle();
  return data || null;
}

function pickWeighted(pool) {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of pool) { if ((r -= p.weight) < 0) return p; }
  return pool[pool.length - 1];
}

export async function spinWheel(guestId) {
  const status = await getLoyaltyStatus(guestId);
  const prize = pickWeighted(PRIZE_POOLS[status.tier.key]);
  const { error } = await supabase.from('wheel_spins').insert({
    id: genSpinId(), guest_id: guestId, spin_date: todayIso(),
    prize_code: prize.code, prize_label: prize.label, redeemed: !prize.redeem,
  });
  if (error) {
    if (error.code === '23505') throw new Error('ALREADY_SPUN');
    throw new Error(error.message);
  }
  if (prize.points) {
    const { data: u } = await supabase.from('users').select('loyalty_points').eq('id', guestId).maybeSingle();
    const balanceAfter = (u?.loyalty_points || 0) + prize.points;
    await supabase.from('users').update({ loyalty_points: balanceAfter }).eq('id', guestId);
    await recordTransaction(guestId, prize.points, `Колесо дня: ${prize.label}`, 'wheel', null, balanceAfter).catch(() => {});
  }
  return { prize, tier: status.tier };
}

export async function getUnredeemedPrizes(limit = 10) {
  const { data: spins, error } = await supabase.from('wheel_spins')
    .select('*').eq('redeemed', false).order('created_at', { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  if (!spins?.length) return [];
  const guestIds = [...new Set(spins.map(s => s.guest_id))];
  const { data: users } = await supabase.from('users').select('id, name').in('id', guestIds);
  const nameById = Object.fromEntries((users || []).map(u => [u.id, u.name]));
  return spins.map(s => ({ ...s, guestName: nameById[s.guest_id] || '' }));
}

export async function markPrizeRedeemed(id) {
  const { data, error } = await supabase.from('wheel_spins').update({ redeemed: true }).eq('id', id).select().single();
  if (error) throw new Error('Приз не найден');
  return data;
}

// ─── История баллов (сайт, вкладка «Уровень») ───────────────────────────────

export async function getLoyaltyHistory(guestId, limit = 50) {
  const { data, error } = await supabase.from('loyalty_transactions')
    .select('*').eq('user_id', guestId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(t => ({
    id: t.id, delta: t.delta, reason: t.reason, sourceType: t.source_type,
    balanceAfter: t.balance_after, createdAt: t.created_at,
  }));
}

// ─── Каталог наград ──────────────────────────────────────────────────────────

function rowToReward(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    costPoints: r.cost_points,
    tierRequired: r.tier_required || null,
    active: r.active,
    expiresAfterDays: r.expires_after_days ?? null,
    createdAt: r.created_at,
  };
}

/** Гостю — активные награды, с пометкой доступности по балансу+уровню. */
export async function getCatalog(guestId) {
  const [{ data: rows, error }, status] = await Promise.all([
    supabase.from('loyalty_rewards').select('*').eq('active', true).order('cost_points', { ascending: true }),
    getLoyaltyStatus(guestId),
  ]);
  if (error) throw new Error(error.message);
  return (rows || []).map(r => {
    const reward = rowToReward(r);
    const tierOk = tierMeets(status.tier.key, reward.tierRequired);
    return { ...reward, tierOk, available: tierOk && status.points >= reward.costPoints };
  });
}

async function genUniqueCode() {
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const { data } = await supabase.from('loyalty_redemptions').select('id').eq('code', code).maybeSingle();
    if (!data) return code;
  }
  throw new Error('Не удалось выпустить код, попробуйте ещё раз');
}

export async function redeemReward(guestId, rewardId) {
  const { data: rewardRow, error: e1 } = await supabase.from('loyalty_rewards').select('*').eq('id', rewardId).maybeSingle();
  if (e1 || !rewardRow) throw new Error('Награда не найдена');
  const reward = rowToReward(rewardRow);
  if (!reward.active) throw new Error('Награда больше не доступна');

  const status = await getLoyaltyStatus(guestId);
  if (!tierMeets(status.tier.key, reward.tierRequired)) {
    const req = TIERS.find(t => t.key === reward.tierRequired);
    throw new Error(`Нужен уровень не ниже «${req?.label || reward.tierRequired}»`);
  }
  if (status.points < reward.costPoints) throw new Error('Недостаточно баллов');

  const code = await genUniqueCode();
  const redemptionId = genRedemptionId();

  // Списание баллов + создание погашения + запись в журнал — одной атомарной
  // RPC (см. supabase/schema.sql, redeem_loyalty_reward), чтобы двойной клик
  // не мог списать баллы дважды и чтобы частичный сбой не оставил баллы
  // списанными без выпущенного кода.
  const { error: rpcError } = await supabase.rpc('redeem_loyalty_reward', {
    p_user_id: guestId, p_reward_id: reward.id, p_cost: reward.costPoints,
    p_redemption_id: redemptionId, p_code: code, p_reason: `Обмен: ${reward.title}`,
  });
  if (rpcError) {
    if (/INSUFFICIENT_POINTS/.test(rpcError.message)) throw new Error('Недостаточно баллов');
    throw new Error(rpcError.message);
  }

  const expiresAt = reward.expiresAfterDays
    ? new Date(Date.now() + reward.expiresAfterDays * 86400000).toISOString()
    : null;
  return { code, reward, expiresAt };
}

function rowToRedemption(r) {
  return {
    id: r.id,
    code: r.code,
    userId: r.user_id,
    rewardId: r.reward_id,
    pointsSpent: r.points_spent,
    status: r.status,
    createdAt: r.created_at,
    redeemedAt: r.redeemed_at || null,
    redeemedByAdminId: r.redeemed_by_admin_id || null,
  };
}

function isRedemptionExpired(redemption, reward) {
  if (!reward?.expiresAfterDays) return false;
  const expiresAt = new Date(redemption.createdAt);
  expiresAt.setDate(expiresAt.getDate() + reward.expiresAfterDays);
  return expiresAt < new Date();
}

/** Находит погашение по коду — для карточки в боте и для ручного поиска в админке. */
export async function findRedemptionByCode(code) {
  const { data, error } = await supabase.from('loyalty_redemptions').select('*').eq('code', code.toUpperCase().trim()).maybeSingle();
  if (error || !data) throw new Error('Код не найден');
  const redemption = rowToRedemption(data);
  const { data: rewardRow } = await supabase.from('loyalty_rewards').select('*').eq('id', redemption.rewardId).maybeSingle();
  const { data: userRow } = await supabase.from('users').select('id, name').eq('id', redemption.userId).maybeSingle();
  return { redemption, reward: rewardRow ? rowToReward(rewardRow) : null, guestName: userRow?.name || 'Гость' };
}

/** Погашение кода барменом/админом — по Telegram-боту или вручную из админки. */
export async function confirmRedemption(code, adminTelegramId) {
  const { redemption, reward } = await findRedemptionByCode(code);

  if (redemption.status === 'redeemed') {
    const time = redemption.redeemedAt ? new Date(redemption.redeemedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    throw new Error(`Уже погашено${time ? ' в ' + time : ''}`);
  }
  if (redemption.status === 'expired' || isRedemptionExpired(redemption, reward)) {
    // Ленивая фиксация просрочки в БД (тот же приём, что expireStalePending в booking.js) —
    // чтобы списки в админке сразу показывали актуальный статус, а не только при попытке погашения.
    if (redemption.status !== 'expired') await supabase.from('loyalty_redemptions').update({ status: 'expired' }).eq('id', redemption.id);
    throw new Error('Код истёк');
  }

  // UPDATE ... WHERE status='issued' — атомарная защита от гонки, если два
  // админа одновременно сканируют один и тот же код (второй увидит affected=0).
  const { data, error } = await supabase.from('loyalty_redemptions')
    .update({ status: 'redeemed', redeemed_at: new Date().toISOString(), redeemed_by_admin_id: adminTelegramId })
    .eq('id', redemption.id).eq('status', 'issued').select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Уже погашено — обновите список');

  return { redemption: rowToRedemption(data), reward };
}

// ─── Админка: CRUD наград ────────────────────────────────────────────────────

export async function getAllRewards() {
  const { data, error } = await supabase.from('loyalty_rewards').select('*').order('cost_points', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(rowToReward);
}

export async function createReward(input) {
  if (!input.title?.trim()) throw new Error('Название обязательно');
  if (!input.costPoints || input.costPoints <= 0) throw new Error('Стоимость в баллах обязательна');
  const row = {
    id: genRewardId(),
    title: input.title.trim(),
    description: input.description?.trim() || '',
    cost_points: parseInt(input.costPoints),
    tier_required: input.tierRequired || null,
    active: input.active !== false,
    expires_after_days: input.expiresAfterDays ? parseInt(input.expiresAfterDays) : null,
  };
  const { data, error } = await supabase.from('loyalty_rewards').insert(row).select().single();
  if (error) throw new Error(error.message);
  return rowToReward(data);
}

export async function updateReward(id, input) {
  const patch = {};
  if ('title' in input)            patch.title              = input.title?.trim() || '';
  if ('description' in input)      patch.description         = input.description?.trim() || '';
  if ('costPoints' in input)       patch.cost_points          = parseInt(input.costPoints) || 0;
  if ('tierRequired' in input)     patch.tier_required        = input.tierRequired || null;
  if ('active' in input)           patch.active               = !!input.active;
  if ('expiresAfterDays' in input) patch.expires_after_days   = input.expiresAfterDays ? parseInt(input.expiresAfterDays) : null;

  const { data, error } = await supabase.from('loyalty_rewards').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Награда не найдена');
  return rowToReward(data);
}

export async function deleteReward(id) {
  const { error } = await supabase.from('loyalty_rewards').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Админка: последние погашения с опциональным фильтром по статусу. */
export async function getRedemptions({ status, limit = 50 } = {}) {
  let q = supabase.from('loyalty_redemptions').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const redemptions = (data || []).map(rowToRedemption);
  if (!redemptions.length) return [];

  const rewardIds = [...new Set(redemptions.map(r => r.rewardId))];
  const userIds = [...new Set(redemptions.map(r => r.userId))];
  const [{ data: rewards }, { data: users }] = await Promise.all([
    supabase.from('loyalty_rewards').select('id, title').in('id', rewardIds),
    supabase.from('users').select('id, name').in('id', userIds),
  ]);
  const rewardTitleById = Object.fromEntries((rewards || []).map(r => [r.id, r.title]));
  const guestNameById = Object.fromEntries((users || []).map(u => [u.id, u.name]));

  return redemptions.map(r => ({
    ...r,
    rewardTitle: rewardTitleById[r.rewardId] || '—',
    guestName: guestNameById[r.userId] || 'Гость',
  }));
}
