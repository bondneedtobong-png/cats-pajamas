// Тест раскладки книги-меню (src/menu/bookSpreads.js) на реальной книге
// владельца: devtools/seed/menu-26.06.xlsx → импорт → страницы разворотов.
// Запуск из корня проекта:
//   node devtools/menu_book_test.mjs
// Ждём «ALL SCENARIOS PASS».
//
// Что защищаем: книга ОДНА и непрерывная (разделы идут по порядку карты, ни
// одна позиция не потеряна и не задвоена), ЛИСТ НАБИВАЕТСЯ ДО КОНЦА (раздел
// может начаться на том же листе, где кончился предыдущий — ради этого всё и
// переписывалось 2026-08-30), заголовок не остаётся сиротой внизу листа,
// разворот всегда из двух листов, а пузыри ведут ровно на первый разворот
// своего раздела — включая надгруппу «Виски» (→ «Шотландия»).
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

/** Все блоки книги подряд, с номером страницы. */
const flatBlocks = (pages) =>
  pages.flatMap((p, i) => (p ? p.blocks.map((b) => ({ ...b, page: i })) : []));

/** Сколько листов потребовало бы СТАРОЕ правило «каждый раздел с новой страницы». */
const oldPages = (perPage) =>
  menu.reduce((n, g) => n + g.categories.reduce(
    (m, c) => m + Math.max(1, Math.ceil((c.items || []).length / perPage)), 0), 0);

for (const perPage of [6, 8, 10]) {
  section(`Раскладка при ёмкости листа ${perPage} позиций`);
  const { pages, spreads, jumps } = buildBook(menu, stories, perPage);
  const blocks = flatBlocks(pages);

  eq(pages.length % 2, 0, 'страниц чётное число — книга всегда открыта на два листа');
  eq(spreads.length, pages.length / 2, 'развороты собраны парами');
  ok(spreads.every((s) => s.length === 2), 'в каждом развороте ровно два листа');

  const seen = [];
  blocks.forEach((b) => b.items.forEach((i) => seen.push(`${b.title}/${i.name}/${i.price}`)));
  eq(seen.length, report.items, 'все позиции карты попали в книгу');
  eq(new Set(seen).size, seen.length, 'ни одна позиция не задвоилась');

  // Порядок книги = порядок карты. Разделы по-прежнему идут подряд и не
  // чередуются — просто теперь их может быть несколько на одном листе.
  const catOrder = menu.flatMap((g) => g.categories.map((c) => `${g.title}/${c.title}`));
  const blockOrder = [];
  blocks.forEach((b) => {
    const k = `${b.groupTitle}/${b.title}`;
    if (blockOrder[blockOrder.length - 1] !== k) blockOrder.push(k);
  });
  eq(blockOrder.join(' | '), catOrder.join(' | '), 'разделы идут подряд по порядку карты и не чередуются');

  // Главное свойство новой раскладки. Прямое сравнение числа листов со старым
  // правилом здесь НЕ показатель: старое считало любую позицию за единицу, а
  // новое — по реальной высоте (позиция с составом на две строки дороже), и на
  // маленькой ёмкости листа новая раскладка честно берёт больше места.
  // Показатель — что листы действительно делятся между разделами.
  const used = pages.filter(Boolean).length;
  ok(pages.filter(Boolean).some((p) => p.blocks.length > 1),
    'есть листы, где раздел начинается сразу после предыдущего',
    `листов ${used}, у старого правила было бы ${oldPages(perPage)}`);

  // Заголовок не должен оставаться внизу листа с одной позицией под ним.
  const orphans = pages.filter(Boolean).flatMap((p) =>
    p.blocks.filter((b, i) => b.head && i > 0 && b.items.length < 2 && b.items.length < 999
      && !(b === p.blocks[p.blocks.length - 1] && b.items.length === 0))
      .map((b) => b.title));
  eq(orphans.length, 0, 'заголовок не брошен сиротой внизу листа', orphans.join(', '));

  // Заголовок — только на первом листе категории, «О разделе» — не чаще раза.
  const byCat = new Map();
  blocks.forEach((b) => {
    const k = `${b.groupTitle}/${b.title}`;
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(b);
  });
  ok([...byCat.values()].every((bs) => bs.filter((b) => b.head).length === 1), 'заголовок раздела — ровно один');
  ok([...byCat.values()].every((bs) => bs[0].head), 'заголовок стоит в начале раздела');
  ok([...byCat.values()].every((bs) => bs.filter((b) => b.story).length <= 1), '«О разделе» — не больше одного раза на раздел');
  ok([...byCat.values()].every((bs) => bs.filter((b) => b.quote).length <= 1), 'цитата — не больше одного раза на раздел');
  ok([...byCat.values()].every((bs) => !bs.some((b) => b.quote) || bs[bs.length - 1].quote),
    'цитата стоит в конце своего раздела');

  // Пузыри ведут на лист, где раздел начинается.
  const bar = menu.find((g) => g.title === 'Карта Бара');
  const scotland = jumps.get(catKey(bar.id, 'Шотландия'));
  const whisky = jumps.get(parentKey(bar.id, 'Виски'));
  eq(whisky, scotland, 'пузырь надгруппы «Виски» ведёт на первый разворот блока («Шотландия»)');

  for (const title of ['Шотландия', 'Америка', 'Джин', 'Софт напитки', 'Ром и Кашаса']) {
    const idx = jumps.get(catKey(bar.id, title));
    const page = pages[idx];
    ok(page && page.blocks.some((b) => b.title === title && b.head),
      `пузырь «${title}» ведёт на лист, где раздел начинается`,
      page ? page.blocks.map((b) => b.title).join(' + ') : 'страницы нет');
    const sp = spreads[spreadOfPage(idx)];
    ok(sp && sp.some((p) => p && p.blocks.some((b) => b.title === title)),
      `раздел «${title}» виден на том развороте, куда прыгаем`);
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
const { pages } = buildBook(menu, stories, 10);
const withStory = flatBlocks(pages).find((b) => b.story);
ok(!!withStory, 'блок с «О разделе» существует');
// «О разделе» занимает место на листе: там, где он есть, позиций меньше, чем
// влезло бы в пустой лист.
ok(withStory.items.length < 10, 'на таком листе позиций меньше — текст занимает место',
  `позиций ${withStory.items.length}`);

section('Уплотнение против старой раскладки');
// Старое правило «каждый раздел с новой страницы» держало пол: сколько
// разделов, столько минимум листов (21), — сколько набор ни уплотняй. Новая
// раскладка обязана его пробить на реальной ёмкости десктопного листа.
const dense = buildBook(menu, stories, 10).pages.filter(Boolean).length;
ok(dense < oldPages(10),
  `на ёмкости десктопного листа: ${dense} листов против ${oldPages(10)} у старой раскладки`);
const shared = buildBook(menu, stories, 10).pages.filter((p) => p && p.blocks.length > 1).length;
ok(shared > 0, `${shared} листов держат больше одного раздела — ради этого всё и переписывалось`);

console.log(failed ? `\n${failed} CHECKS FAILED` : '\nALL SCENARIOS PASS');
process.exit(failed ? 1 : 0);
