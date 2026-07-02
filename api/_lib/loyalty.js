import { supabase } from './supabase.js';

// Программа лояльности + ежедневное колесо. Пока живёт только в боте
// (сайт её не показывает — по решению владельца это следующая фаза).
// Баллы начисляются, когда бронь переходит в статус 'completed'
// (см. awardVisitPoints, вызывается из booking.js/updateReservationStatus).

const VISIT_POINTS = 10;

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

function genSpinId() { return 'ws_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function todayIso() { return new Date().toISOString().split('T')[0]; }

export function tierForPoints(points) {
  let cur = TIERS[0];
  for (const t of TIERS) if (points >= t.min) cur = t;
  return cur;
}

export function nextTier(points) {
  return TIERS.find(t => t.min > points) || null;
}

/** Best-effort: начисляет баллы за визит. Не бросает — вызывающий код (booking.js)
 *  не должен падать, если начисление не удалось. */
export async function awardVisitPoints(guestId) {
  if (!guestId) return;
  const { data: user } = await supabase.from('users').select('id, loyalty_points').eq('id', guestId).maybeSingle();
  if (!user) return;
  await supabase.from('users').update({ loyalty_points: (user.loyalty_points || 0) + VISIT_POINTS }).eq('id', guestId);
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
    await supabase.from('users').update({ loyalty_points: (u?.loyalty_points || 0) + prize.points }).eq('id', guestId);
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
