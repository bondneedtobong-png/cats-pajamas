// Тест раскладки книги-меню (src/menu/bookSpreads.js) на реальной книге
// владельца: devtools/seed/menu-26.06.xlsx → импорт → страницы разворотов.
// Запуск из корня проекта:
//   node devtools/menu_book_test.mjs
// Ждём «ALL SCENARIOS PASS».
//
// Что защищаем: книга ОДНА и непрерывная (страницы идут по порядку карты, ни
// одна позиция не потеряна и не задвоена), категория не смешивается на листе с
// соседней, разворот всегда из двух листов, а пузыри ведут ровно на первый
// разворот своего раздела — включая надгруппу «Виски» (→ «Шотландия»).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(root, 'devtools', 'seed', 'menu-26.06.xlsx');

const { importMenuFromExcel } = await import('../src/menu/excelImport.js');
const { buildBook, buildNav, catKey, parentKey, spreadOfPage } = await import('../src/menu/bookSpreads.js');

let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { console.log('  ✓', name); return; }
  failed += 1;
  console.log('  ✗', name, extra ? `\n      ${extra}` : '');
};
const eq = (a, b, name) => ok(a === b, name, `ожидали ${JSON.stringify(b)}, получили ${JSON.stringify(a)}`);
const section = (t) => console.log(`\n${t}`);

const buf = await readFile(FIXTURE);
const { menu, stories, report } = await importMenuFromExcel(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

for (const perPage of [4, 5, 6]) {
  section(`Раскладка при ${perPage} позициях на странице`);
  const { pages, spreads, jumps } = buildBook(menu, stories, perPage);

  eq(pages.length % 2, 0, 'страниц чётное число — книга всегда открыта на два листа');
  eq(spreads.length, pages.length / 2, 'развороты собраны парами');
  ok(spreads.every((s) => s.length === 2), 'в каждом развороте ровно два листа');

  const seen = [];
  pages.filter(Boolean).forEach((p) => p.items.forEach((i) => seen.push(`${p.title}/${i.name}/${i.price}`)));
  eq(seen.length, report.items, 'все позиции карты попали в книгу');
  eq(new Set(seen).size, seen.length, 'ни одна позиция не задвоилась');

  // Порядок книги = порядок карты, и лист не смешивает две категории.
  const catOrder = menu.flatMap((g) => g.categories.map((c) => `${g.title}/${c.title}`));
  const pageOrder = [];
  pages.filter(Boolean).forEach((p) => {
    const k = `${p.groupTitle}/${p.title}`;
    if (pageOrder[pageOrder.length - 1] !== k) pageOrder.push(k);
  });
  eq(pageOrder.join(' | '), catOrder.join(' | '), 'страницы идут подряд по порядку карты, категории не чередуются');

  ok(pages.filter(Boolean).every((p) => p.items.length <= perPage), 'на странице не больше нормы позиций',
    pages.filter(Boolean).map((p) => p.items.length).join(','));

  // Заголовок — только на первом листе категории, цитата — только на последнем.
  const byCat = new Map();
  pages.filter(Boolean).forEach((p) => {
    const k = `${p.groupTitle}/${p.title}`;
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(p);
  });
  ok([...byCat.values()].every((ps) => ps.filter((p) => p.head).length === 1), 'заголовок раздела — ровно на одном листе');
  ok([...byCat.values()].every((ps) => ps[0].head), 'заголовок стоит на первом листе раздела');
  ok([...byCat.values()].every((ps) => ps.filter((p) => p.story).length <= 1), '«О разделе» — не больше одного раза на раздел');

  // Пузыри ведут на первый лист своего раздела.
  const bar = menu.find((g) => g.title === 'Карта Бара');
  const scotland = jumps.get(catKey(bar.id, 'Шотландия'));
  const whisky = jumps.get(parentKey(bar.id, 'Виски'));
  eq(whisky, scotland, 'пузырь надгруппы «Виски» ведёт на первый разворот блока («Шотландия»)');
  ok(pages[scotland] && pages[scotland].title === 'Шотландия' && pages[scotland].head,
    'по прыжку открывается именно первый лист «Шотландии»',
    pages[scotland] ? `${pages[scotland].title}, head=${pages[scotland].head}` : 'нет страницы');

  for (const title of ['Америка', 'Джин', 'Софт напитки', 'Ром и Кашаса']) {
    const idx = jumps.get(catKey(bar.id, title));
    const page = pages[idx];
    ok(page && page.title === title && page.head, `пузырь «${title}» ведёт на первый лист раздела`,
      page ? `получили «${page.title}»` : 'раздела нет в книге');
    const sp = spreads[spreadOfPage(idx)];
    ok(sp && sp.some((p) => p && p.title === title), `раздел «${title}» виден на том развороте, куда прыгаем`);
  }
}

section('Пузыри навигации');
const nav = buildNav(menu);
eq(nav.length, menu.length, 'группы карты = группы пузырей');
const barNav = nav.find((g) => g.title === 'Карта Бара');
const whiskyEntry = barNav.entries.find((e) => e.type === 'parent' && e.title === 'Виски');
ok(!!whiskyEntry, '«Виски» — пузырь-надгруппа');
eq((whiskyEntry?.children || []).map((c) => c.title).join(' | '),
  'Шотландия | Ирландия | Америка | Виски со Всего Мира', 'у «Виски» четыре дочерних пузыря');
ok(barNav.entries.filter((e) => e.type === 'cat').some((e) => e.title === 'Джин'),
  '«Джин» — обычный плоский пузырь, а не ребёнок «Виски»');
eq(barNav.entries.length, 16, 'на верхнем уровне «Карты Бара» 15 разделов + надгруппа «Виски»');

section('Уважение к содержимому');
const { pages } = buildBook(menu, stories, 6);
const first = pages.find((p) => p && p.story);
ok(!!first, 'страница с «О разделе» существует');
ok(first.items.length <= 4, 'на такой странице позиций меньше — текст занимает место',
  `позиций ${first.items.length}`);
const quoted = pages.filter((p) => p && p.quote);
ok(quoted.every((p) => {
  const idx = pages.indexOf(p);
  const next = pages[idx + 1];
  return !next || next.title !== p.title;
}), 'цитата стоит на последнем листе своего раздела');

console.log(failed ? `\n${failed} CHECKS FAILED` : '\nALL SCENARIOS PASS');
process.exit(failed ? 1 : 0);
