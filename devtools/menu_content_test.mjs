// Сверка карты сайта с бумажным меню, ПОСТРОЧНО.
//   node devtools/menu_content_test.mjs
// Ждём «ALL SCENARIOS PASS».
//
// Источник истины — devtools/seed/menu-data-final.json (визуально сверенная
// копия Пижама_кота_основное_меню_2.0.pdf, 36 страниц). Тест независимо от
// генератора обходит JSON и требует, чтобы КАЖДАЯ позиция нашлась в
// src/menu/barMenuData.js ровно один раз с тем же названием, объёмом, страной
// или составом и той же ценой. Так опечатка при переносе не доедет до прода.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = JSON.parse(await readFile(join(root, 'devtools', 'seed', 'menu-data-final.json'), 'utf8'));
const { BAR_MENU } = await import('../src/menu/barMenuData.js');
const { buildBook, buildNav } = await import('../src/menu/bookSpreads.js');

let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) return;
  failed += 1;
  console.log('  ✗', name, extra ? `\n      ${extra}` : '');
};
const eq = (a, b, name) => ok(a === b, name, `ожидали ${JSON.stringify(b)}, получили ${JSON.stringify(a)}`);
const section = (t) => console.log(`\n${t}`);

const cats = BAR_MENU.flatMap((g) => g.categories);
const byTitle = new Map(cats.map((c) => [c.title, c]));
const rub = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;

/** Разделы JSON (кроме служебного _meta) → раздел карты сайта. */
const MAP = [
  ['закуски', 'Закуски'],
  ['коктейли', 'Коктейли'],
  ['бестселлеры', 'Бестселлеры'],
  ['безалкогольные_коктейли', 'Безалкогольные коктейли'],
  ['крепленые_вина_и_вермуты', 'Креплёные вина и вермуты'],
  ['ром_и_кашаса', 'Ром и кашаса'],
  ['текила_и_мескаль', 'Текила и мескаль'],
  ['джин', 'Джин'],
  ['коньяк', 'Коньяк'],
  ['дистилляты', 'Дистилляты'],
  ['водка', 'Водка'],
  ['биттеры_и_аперитивы', 'Биттеры и аперитивы'],
  ['ликеры_и_настойки', 'Ликёры и настойки'],
  ['пиво_и_сидр', 'Пиво и сидр'],
  ['лимонады', 'Лимонады'],
  ['чай', 'Чай'],
  ['софт_напитки', 'Софт-напитки'],
];
const WHISKY = ['Шотландия', 'Ирландия', 'Америка', 'Со всего мира'];

/** Одна позиция JSON против позиции карты. */
function compareItem(src, got, where, sectionUnit) {
  eq(got?.name, src.name, `${where}: название`);
  if (!got) return;
  const origin = src.desc || src.country || '';
  eq(got.origin || '', origin, `${where}: состав/страна`);
  // Объём позиции: свой, а если его нет — объём раздела (лимонады, чай).
  const vol = src.volume_ml ? `${src.volume_ml} мл` : (src.weight_g ? `${src.weight_g} г` : (sectionUnit || ''));
  eq(got.volume ?? sectionUnit ?? '', vol, `${where}: объём`);
  eq(got.price ?? '', src.price === undefined ? '' : rub(src.price), `${where}: цена`);
}

/** Раздел JSON против раздела карты. */
function compareSection(node, title) {
  const cat = byTitle.get(title);
  ok(cat, `раздел «${title}» есть в карте сайта`);
  if (!cat) return;
  eq(cat.items.length, node.items.length, `«${title}»: число позиций`);
  const unit = node.volume_ml ? `${node.volume_ml} мл` : '';
  eq(cat.unit || '', unit, `«${title}»: объём раздела`);
  eq(cat.subtitle || '', node.price_all ? rub(node.price_all) : '', `«${title}»: единая цена раздела`);
  node.items.forEach((src, i) => compareItem(src, cat.items[i], `«${title}» №${i + 1}`, cat.unit));
  if (node.quote) {
    ok(cat.quote, `«${title}»: цитата перенесена`);
    if (cat.quote) {
      const joined = cat.quote.author ? `${cat.quote.text} (${cat.quote.author})` : cat.quote.text;
      const src = String(node.quote).trim();
      ok(joined === src || `${cat.quote.text} ${cat.quote.author}`.trim() === src,
        `«${title}»: текст цитаты дословно`, `\n      JSON: ${src}\n      карта: ${joined}`);
    }
  } else {
    ok(!cat.quote, `«${title}»: лишней цитаты нет`);
  }
}

section('Построчная сверка с бумажным меню');
for (const [key, title] of MAP) compareSection(J[key], title);
WHISKY.forEach((title, i) => compareSection(J.виски.subsections[i], title));
console.log(`  ✓ сверено разделов: ${MAP.length + WHISKY.length}`);

section('Ничего лишнего и ничего не потеряно');
const jsonCount = [...MAP.map(([k]) => J[k]), ...J.виски.subsections]
  .reduce((n, s) => n + s.items.length, 0);
eq(cats.reduce((n, c) => n + c.items.length, 0), jsonCount, 'позиций в карте = позиций в PDF');
eq(cats.filter((c) => c.kind !== 'text').length, MAP.length + WHISKY.length, 'разделов в карте = разделов в PDF');
const wines = cats.filter((c) => /вина|вино|игрист|портвейн|херес/i.test(c.title) && c.title !== 'Креплёные вина и вермуты');
eq(wines.length, 0, 'разделов вин в карте нет (решение владельца)');
eq(cats.filter((c) => c.title === 'Авторские коктейли').length, 0, 'страницы «Авторские коктейли» нет');
const names = cats.flatMap((c) => c.items.map((i) => `${c.title}/${i.name}`));
eq(new Set(names).size, names.length, 'позиции не задвоены');

section('Первая и последняя страницы');
const text = cats.filter((c) => c.kind === 'text');
eq(text.length, 2, 'две страницы без списка позиций');
eq(text[0].text, J._meta.первая_страница.текст, 'приветствие дословно');
eq(text[0].sign, J._meta.первая_страница.подпись, 'подпись под приветствием');
eq(text[1].text, J._meta.последняя_страница.текст, 'закрывающая страница дословно');
ok(cats.indexOf(text[0]) === 0, 'приветствие — первый раздел карты');
ok(cats.indexOf(text[1]) === cats.length - 1, '«мы в сети» — последний раздел карты');

section('Раскладка и навигация на новой карте');
const { pages, spreads, jumps } = buildBook(BAR_MENU, {});
ok(pages.length > 0, 'книга собралась');
eq(spreads.length, Math.ceil(pages.length / 2), 'разворотов = половина страниц');
ok(pages.length % 2 === 0, 'число страниц чётное — книга всегда открыта на два листа');
const flat = pages.flatMap((p, i) => (p ? p.blocks.map((b) => ({ ...b, page: i })) : []));
eq(flat.filter((b) => b.kind === 'text').length, 2, 'текстовые страницы дошли до книги');
for (const b of flat.filter((x) => x.kind === 'text')) {
  const solo = flat.filter((x) => x.page === b.page);
  eq(solo.length, 1, `текстовая страница «${b.title}» занимает лист целиком`);
}
const laid = flat.filter((b) => b.kind !== 'text').flatMap((b) => b.items.map((i) => i.name));
eq(laid.length, jsonCount, 'в разложенной книге все позиции PDF');

const nav = buildNav(BAR_MENU);
const entries = nav.flatMap((g) => g.entries);
eq(entries.filter((e) => e.type === 'parent').length, 1, 'одна надгруппа — «Виски»');
eq(entries.find((e) => e.type === 'parent')?.children.length, 4, 'у «Виски» четыре подраздела');
eq(entries.length, MAP.length + 1, 'пузырей = разделы верхнего уровня + «Виски»');
ok(!entries.some((e) => e.title === 'The Cat’s Pajamas' || e.title === 'Оставайтесь на связи'),
  'страницы-тексты пузыря не дают');
for (const e of entries) ok(jumps.has(e.key), `пузырь «${e.title}» ведёт на страницу`);
console.log(`  ✓ пузырей: ${entries.length}, страниц: ${pages.length}, разворотов: ${spreads.length}`);

console.log(failed ? `\n${failed} FAILED` : '\nALL SCENARIOS PASS');
process.exit(failed ? 1 : 0);
