// Генератор src/menu/barMenuData.js из выверенного JSON бумажного меню
// (menu-data-final.json, 36 страниц PDF, сверено владельцем визуально).
//
//   node devtools/gen_menu_data.mjs <путь к menu-data-final.json>
//
// Переносить карту руками нельзя: 250+ позиций, любая опечатка в названии,
// цене или объёме уедет на прод. Поэтому barMenuData.js СГЕНЕРИРОВАН — правки
// вносим в JSON и перегенерируем, а не редактируем вывод.
//
// Соответствие полей JSON → схема сайта (та же, что в БД, админке и импортёре
// Excel; менять её ради других имён полей = ломать 8 файлов и прод-данные):
//   name                       → name
//   desc | country             → origin   (курсивная строка под названием)
//   volume_ml | weight_g       → volume   ('40 мл' / '100 г')
//   price                      → price    ('580 ₽')
//   price_all                  → subtitle раздела ('880 ₽'), у позиций цены нет
//   volume_ml на разделе       → unit     (объём по умолчанию для позиций)
//   quote                      → { text, author } — автор из хвоста «(…)»
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('Укажите путь к menu-data-final.json'); process.exit(1); }
const J = JSON.parse(await readFile(src, 'utf8'));

const rub = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;

/** «текст (Автор)» → { text, author }. Без скобок — автора нет. */
function quoteOf(raw, forcedAuthor = '') {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(.*?)\s*\(([^()]+)\)\s*$/s);
  if (m) return { text: m[1].trim(), author: m[2].trim() };
  if (forcedAuthor && s.endsWith(forcedAuthor)) {
    return { text: s.slice(0, -forcedAuthor.length).trim(), author: forcedAuthor };
  }
  return { text: s, author: '' };
}

/** Позиция JSON → позиция карты. */
function item(it, { unitVolume = null } = {}) {
  const o = { name: it.name };
  const origin = it.desc || it.country || '';
  if (origin) o.origin = origin;
  const vol = it.volume_ml ? `${it.volume_ml} мл` : (it.weight_g ? `${it.weight_g} г` : '');
  // Объём печатаем у позиции только если он отличается от объёма раздела.
  if (vol && vol !== unitVolume) o.volume = vol;
  if (it.price !== undefined) o.price = rub(it.price);
  return o;
}

/** Раздел карты. */
function cat(title, node, extra = {}) {
  const unit = node.volume_ml ? `${node.volume_ml} мл` : '';
  const c = { title };
  if (extra.parent) c.parent = extra.parent;
  if (unit) c.unit = unit;
  if (node.price_all) c.subtitle = rub(node.price_all);
  c.items = (node.items || []).map((it) => item(it, { unitVolume: unit }));
  const q = quoteOf(node.quote, extra.author);
  if (q) c.quote = q;
  return c;
}

const W = J.виски.subsections;
const whisky = (i, title) => cat(title, W[i], { parent: 'Виски' });

const MENU = [
  {
    id: 'intro',
    title: 'Приветствие',
    categories: [{
      title: 'The Cat’s Pajamas',
      kind: 'text',
      nav: false,
      text: J._meta.первая_страница.текст,
      sign: J._meta.первая_страница.подпись,
      items: [],
    }],
  },
  {
    id: 'kitchen',
    title: 'Кухня',
    categories: [cat('Закуски', J.закуски)],
  },
  {
    id: 'cocktails',
    title: 'Коктейли',
    categories: [
      cat('Коктейли', J.коктейли),
      cat('Бестселлеры', J.бестселлеры),
      cat('Безалкогольные коктейли', J.безалкогольные_коктейли, { author: 'Пижама кота' }),
    ],
  },
  {
    id: 'spirits',
    title: 'Крепкий алкоголь',
    categories: [
      cat('Креплёные вина и вермуты', J.крепленые_вина_и_вермуты),
      cat('Ром и кашаса', J.ром_и_кашаса),
      cat('Текила и мескаль', J.текила_и_мескаль),
      whisky(0, 'Шотландия'),
      whisky(1, 'Ирландия'),
      whisky(2, 'Америка'),
      whisky(3, 'Со всего мира'),
      cat('Джин', J.джин),
      cat('Коньяк', J.коньяк),
      cat('Дистилляты', J.дистилляты),
      cat('Водка', J.водка),
      cat('Биттеры и аперитивы', J.биттеры_и_аперитивы),
      cat('Ликёры и настойки', J.ликеры_и_настойки),
    ],
  },
  {
    id: 'soft',
    title: 'Пиво и напитки',
    categories: [
      cat('Пиво и сидр', J.пиво_и_сидр),
      cat('Лимонады', J.лимонады),
      cat('Чай', J.чай),
      cat('Софт-напитки', J.софт_напитки),
    ],
  },
  {
    id: 'outro',
    title: 'Мы в сети',
    categories: [{
      title: 'Оставайтесь на связи',
      kind: 'text',
      nav: false,
      text: J._meta.последняя_страница.текст,
      links: J._meta.последняя_страница.ссылки,
      items: [],
    }],
  },
];

/* ── Печать в JS-литерал: позиции в одну строку, как в прежнем файле ─────── */
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const obj = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? q(v) : JSON.stringify(v)}`).join(', ')} }`;

const catSrc = (c) => {
  const L = ['      {'];
  L.push(`        title: ${q(c.title)},`);
  if (c.parent) L.push(`        parent: ${q(c.parent)},`);
  if (c.kind) L.push(`        kind: ${q(c.kind)},`);
  if (c.nav === false) L.push('        nav: false,');
  if (c.unit) L.push(`        unit: ${q(c.unit)},`);
  if (c.subtitle) L.push(`        subtitle: ${q(c.subtitle)},`);
  if (c.text) L.push(`        text: ${q(c.text)},`);
  if (c.sign) L.push(`        sign: ${q(c.sign)},`);
  if (c.links) L.push(`        links: ${JSON.stringify(c.links)},`);
  if (c.items.length) {
    L.push('        items: [');
    for (const it of c.items) L.push(`          ${obj(it)},`);
    L.push('        ],');
  } else {
    L.push('        items: [],');
  }
  if (c.quote) L.push(`        quote: ${obj(c.quote)},`);
  L.push('      },');
  return L.join('\n');
};

const groupSrc = (g) => [
  '  {',
  `    id: ${q(g.id)},`,
  `    title: ${q(g.title)},`,
  '    categories: [',
  g.categories.map(catSrc).join('\n'),
  '    ],',
  '  },',
].join('\n');

const header = `// Барная карта бара «Пижама кота» — ЕДИНЫЙ ИСТОЧНИК контента меню.
//
// ⚠️ ФАЙЛ СГЕНЕРИРОВАН: devtools/gen_menu_data.mjs из выверенного бумажного
// меню (Пижама_кота_основное_меню_2.0.pdf, 36 страниц, сверено владельцем
// постранично). Руками не править — правь JSON и перегенерируй, иначе правка
// потеряется при следующей генерации.
//
// Из карты 2026-09-05 УБРАНЫ (решение владельца): все разделы вин
// (белые/красные/розовые/игристые/безалкогольные/портвейн и херес) и страница
// «Авторские коктейли» со старыми ценами 750/700/850 ₽ — их позиции переехали
// в «Коктейли» и «Бестселлеры» с актуальными 880/980 ₽.
//
// Структура: группы → разделы → позиции { name, origin?, volume?, price? }.
//   origin   — состав коктейля или страна (курсивом под названием);
//   volume   — объём позиции; пуст → берётся unit раздела;
//   subtitle — единая цена раздела («880 ₽»), у позиций цены нет;
//   kind:'text' — страница без списка: приветствие и «мы в сети»; такой раздел
//                 всегда занимает отдельный лист и не даёт пузыря (nav: false).
//
// Раскладка по страницам книги считается в рантайме по РЕАЛЬНЫМ замерам
// вёрстки (src/menu/paginate.js) — «сколько влезает» здесь не задаётся.

// Тексты «О разделе» — необязательная надстройка сайта, в бумажном меню их
// нет. Пусто по решению владельца 2026-09-05: книга на сайте должна совпадать
// с печатной картой один в один. Владелец добавляет свои тексты через админку
// (ключ — точное название раздела).
export const CATEGORY_STORIES = {};

export const BAR_MENU = [
`;

await writeFile(join(root, 'src', 'menu', 'barMenuData.js'), header + MENU.map(groupSrc).join('\n') + '\n];\n');

const cats = MENU.flatMap((g) => g.categories);
console.log(`Групп ${MENU.length}, разделов ${cats.length}, позиций ${cats.reduce((n, c) => n + c.items.length, 0)}`);
