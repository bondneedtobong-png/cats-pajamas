import { supabase } from './supabase.js';
import { BAR_MENU, CATEGORY_STORIES } from '../../src/menu/barMenuData.js';

// Барная карта редактируется владельцем и хранится одним jsonb-блобом в
// app_config['bar_menu'] = { menu: [...группы], stories: {...} }.
// Категории внутри группы — плоский список; третий уровень (надгруппа вроде
// «Виски» над Шотландией и Ирландией) выражен полем category.parent —
// названием надгруппы у каждого её раздела.
// Пока владелец ничего не сохранил (конфиг пуст/битый) — отдаём статическую
// карту из репозитория (src/menu/barMenuData.js), чтобы сайт и /menu никогда
// не остались без меню. Правки владельца попадают в SEO-пререндер только на
// следующем деплое (scripts/prerender-menu.mjs собирается при build).

const CONFIG_KEY = 'bar_menu';
const STATIC = { menu: BAR_MENU, stories: CATEGORY_STORIES };

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const slug = (s) =>
  str(s, 40).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'g';

function cleanItem(it) {
  const name = str(it?.name, 200);
  if (!name) return null;
  const out = { name, price: str(it?.price, 60) };
  const origin = str(it?.origin, 600); if (origin) out.origin = origin;
  const volume = str(it?.volume, 60);  if (volume) out.volume = volume;
  return out;
}

function cleanCategory(c) {
  const title = str(c?.title, 120);
  if (!title) return null;
  const out = {
    title,
    items: (Array.isArray(c?.items) ? c.items : []).map(cleanItem).filter(Boolean),
  };
  const unit = str(c?.unit, 40); if (unit) out.unit = unit;
  // Единая цена раздела («880 ₽») — подпись под названием, НЕ объём позиции.
  const subtitle = str(c?.subtitle, 60); if (subtitle) out.subtitle = subtitle;
  const parent = str(c?.parent, 120); if (parent && parent !== title) out.parent = parent;
  // Страница без списка позиций: приветствие и «мы в сети» — такие же
  // развороты бумажного меню, только текстом. Раздел без items выживает
  // только с kind: 'text', иначе пустой раздел по-прежнему выкидывается.
  if (c?.kind === 'text') {
    out.kind = 'text';
    out.text = str(c?.text, 4000);
    const sign = str(c?.sign, 200); if (sign) out.sign = sign;
    const links = (Array.isArray(c?.links) ? c.links : [])
      .map((l) => str(l, 40)).filter(Boolean).slice(0, 6);
    if (links.length) out.links = links;
  }
  if (c?.nav === false) out.nav = false;
  const qText = str(c?.quote?.text, 400);
  if (qText) out.quote = { text: qText, author: str(c?.quote?.author, 120) };
  return out;
}

function cleanGroup(g) {
  const title = str(g?.title, 120);
  if (!title) return null;
  const categories = (Array.isArray(g?.categories) ? g.categories : [])
    .map(cleanCategory).filter(Boolean)
    // Пустой раздел выкидываем — кроме текстовой страницы, у которой позиций
    // не бывает по определению.
    .filter((c) => c.items.length || c.kind === 'text');
  if (!categories.length) return null;
  return { id: slug(g?.id || title), title, categories };
}

/**
 * Нормализует произвольный payload из админ-редактора в безопасную структуру:
 * обрезает строки, выкидывает пустые позиции/категории/группы, гарантирует
 * уникальные id групп (нужны как якоря навигации на /menu).
 */
export function sanitizeBarMenu(payload) {
  const groups = (Array.isArray(payload?.menu) ? payload.menu : [])
    .map(cleanGroup).filter(Boolean);

  const seen = new Set();
  groups.forEach((g, i) => {
    let id = g.id;
    let suffix = i;
    while (seen.has(id)) id = `${g.id}-${suffix++}`;
    seen.add(id);
    g.id = id;
  });

  const stories = {};
  const src = payload?.stories && typeof payload.stories === 'object' ? payload.stories : {};
  for (const [k, v] of Object.entries(src)) {
    const key = str(k, 120), val = str(v, 2000);
    if (key && val) stories[key] = val;
  }

  return { menu: groups, stories };
}

/** Публичное чтение карты (из БД, фолбэк на статику). Никогда не бросает. */
export async function getBarMenu() {
  try {
    const { data, error } = await supabase
      .from('app_config').select('value,revision').eq('key', CONFIG_KEY).maybeSingle();
    if (error) throw error;
    const v = data?.value;
    if (v && Array.isArray(v.menu) && v.menu.length) {
      return { menu: v.menu, stories: v.stories && typeof v.stories === 'object' ? v.stories : {}, configRevision: data.revision };
    }
    return { ...STATIC, configRevision: data ? data.revision : null };
  } catch (e) {
    console.warn('[barMenu] getBarMenu → статический фолбэк:', e.message);
  }
  return STATIC;
}

/** Compare the monotonic database revision so stale editors cannot overwrite it. */
export async function setBarMenu(payload, configRevision) {
  const conflict = () => Object.assign(new Error('Карта уже изменена или не загружена. Обновите страницу перед сохранением.'), { status: 409 });
  if (configRevision !== null && (!Number.isSafeInteger(configRevision) || configRevision < 0)) throw conflict();
  const clean = sanitizeBarMenu(payload);
  if (!clean.menu.length) throw new Error('Карта не может быть пустой');
  let result;
  if (configRevision === null) {
    result = await supabase.from('app_config').insert({ key: CONFIG_KEY, value: clean }).select('key,revision').single();
    if (result.error?.code === '23505') throw conflict();
  } else {
    result = await supabase.from('app_config').update({ value: clean })
      .eq('key', CONFIG_KEY).eq('revision', configRevision).select('key,revision').maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw conflict();
  if (!Number.isSafeInteger(result.data.revision) || result.data.revision < 0) throw new Error('Версия настроек недоступна');
  return { ...clean, configRevision: result.data.revision };
}
