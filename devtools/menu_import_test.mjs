// Тест импорта барной карты из реальной книги владельца («Меню 26.06
// Дизайнеру.xlsx», фикстура devtools/seed/menu-26.06.xlsx). Проверяет весь
// путь данных: xlsx → excelImport → sanitizeBarMenu (то же, что делает API при
// сохранении) → маркап /menu и JSON-LD пререндера. Запуск из корня проекта:
//   node devtools/menu_import_test.mjs
// Ждём «ALL SCENARIOS PASS».
//
// Главное, что тут защищено: третий уровень («Виски» → Шотландия, Ирландия,
// Америка, Виски со Всего Мира) и то, что соседние разделы (Джин, Коньяк…)
// НЕ проваливаются внутрь «Виски», а все 19 разделов листа «Карта Бара»
// доезжают до конца пайплайна ни разу не потерявшись и не задвоившись.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// api/_lib/supabase.js создаёт клиент на старте — без env он падает. Сети тест
// не касается: sanitizeBarMenu чистая, запросов в БД не делает.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(root, 'devtools', 'seed', 'menu-26.06.xlsx');

const { importMenuFromExcel, buildSheet } = await import('../src/menu/excelImport.js');
const { sanitizeBarMenu } = await import('../api/_lib/barMenu.js');
const { pageHtml, buildSchema } = await import('../scripts/prerender-menu.mjs');

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

const group = (title) => menu.find((g) => g.title === title);
const catsOf = (g) => (g ? g.categories : []);
const cat = (g, title) => catsOf(g).find((c) => c.title === title);

// ── 1. Лист «Карта Бара»: третий уровень ───────────────────────────────────
section('Лист «Карта Бара» — надгруппа «Виски»');
const bar = group('Карта Бара');
ok(!!bar, 'группа «Карта Бара» существует');

const WHISKY_KIDS = ['Шотландия', 'Ирландия', 'Америка', 'Виски со Всего Мира'];
const kids = catsOf(bar).filter((c) => c.parent === 'Виски');
eq(kids.map((c) => c.title).join(' | '), WHISKY_KIDS.join(' | '), 'у «Виски» ровно 4 подраздела в порядке файла');
ok(kids.length > 0 && kids.every((c) => c.items.length > 0), 'у каждого подраздела «Виски» свои позиции',
  kids.map((c) => `${c.title}: ${c.items.length}`).join(', '));
ok(!cat(bar, 'Виски'), '«Виски» — надгруппа, а не отдельная категория-пустышка');
// Позиции подразделов не перемешаны: шотландский виски там, где ему место.
ok((cat(bar, 'Шотландия')?.items || []).some((i) => /Glen|Ardbeg|Laphroaig|Talisker|Monkey|Scotch/i.test(i.name)),
  'позиции «Шотландии» — шотландский виски',
  (cat(bar, 'Шотландия')?.items || []).map((i) => i.name).join(', '));

section('Соседи «Виски» остаются плоскими');
const FLAT_NEIGHBOURS = ['Ром и Кашаса', 'Текила и Мескаль', 'Джин', 'Коньяк', 'Дистилляты',
  'Водка', 'Биттеры и Аперитивы', 'Ликёры и Настойки', 'Пиво и Сидр'];
for (const t of FLAT_NEIGHBOURS) {
  const c = cat(bar, t);
  ok(c && !c.parent, `«${t}» — сосед «Виски», а не его ребёнок`, c ? `parent=${c.parent}` : 'раздела нет');
}

section('Разделы, которых не было на сайте, доехали');
const NEW_FLAT = ['Лимонады', 'Кофе', 'Крафтовый Чай', 'Чай', 'Вода', 'Софт напитки'];
for (const t of NEW_FLAT) {
  const c = cat(bar, t);
  ok(c && !c.parent && c.items.length > 0, `«${t}» — обычный плоский раздел с позициями`,
    c ? `parent=${c.parent}, позиций ${c.items.length}` : 'раздела нет');
}

// ── 2. Полный состав листа: ничего не потеряно и не задвоено ───────────────
section('Полный состав листа «Карта Бара» (19 разделов)');
const EXPECTED_BAR = [
  ['Ром и Кашаса', '', 15], ['Текила и Мескаль', '', 8],
  ['Шотландия', 'Виски', 10], ['Ирландия', 'Виски', 5], ['Америка', 'Виски', 5], ['Виски со Всего Мира', 'Виски', 5],
  ['Джин', '', 11], ['Коньяк', '', 5], ['Дистилляты', '', 7], ['Водка', '', 6],
  ['Биттеры и Аперитивы', '', 10], ['Ликёры и Настойки', '', 15], ['Пиво и Сидр', '', 9],
  ['Лимонады', '', 4], ['Кофе', '', 8], ['Крафтовый Чай', '', 4], ['Чай', '', 10],
  ['Вода', '', 4], ['Софт напитки', '', 8],
];
const actualBar = catsOf(bar).map((c) => [c.title, c.parent || '', c.items.length]);
eq(JSON.stringify(actualBar), JSON.stringify(EXPECTED_BAR), 'разделы, вложенность и число позиций — как в файле');

section('Листы «Карта Коктейлей» и «Креплёные вина» — как раньше');
const cocktails = group('Карта Коктейлей');
eq(catsOf(cocktails).length, 1, 'коктейли: один плоский раздел');
eq(catsOf(cocktails)[0]?.title, 'Коктейльная Карта', 'коктейли: раздел «Коктейльная Карта»');
eq(catsOf(cocktails)[0]?.items.length, 17, 'коктейли: 17 позиций');
ok(catsOf(cocktails).every((c) => !c.parent), 'коктейли: никакой вложенности');
ok(catsOf(cocktails)[0]?.items.every((i) => i.origin && i.price), 'коктейли: у позиции состав и цена');
const wine = group('Креплёные вина');
eq(catsOf(wine).length, 1, 'вина: один плоский раздел');
eq(catsOf(wine)[0]?.title, 'Крепленые вина и Вермуты', 'вина: раздел «Крепленые вина и Вермуты»');
eq(catsOf(wine)[0]?.items.length, 12, 'вина: 12 позиций');
ok(catsOf(wine).every((c) => !c.parent), 'вина: никакой вложенности');

section('Итоги импорта');
eq(menu.length, 3, 'групп 3 (по листу на группу)');
eq(report.categories, 21, 'разделов 21');
eq(report.items, 178, 'позиций 178');
eq(report.warnings.length, 0, 'предупреждений нет — надгруппа разобрана, а не расплющена',
  report.warnings.join(' / '));
const keys = menu.flatMap((g) => g.categories.flatMap((c) => c.items.map((i) => `${g.title}/${c.title}/${i.name}/${i.price}`)));
eq(new Set(keys).size, keys.length, 'ни одна позиция не задвоилась',
  keys.filter((k, i) => keys.indexOf(k) !== i).join(', '));
ok(Object.keys(stories).length >= 9, `описаний «О разделе» ${Object.keys(stories).length}`);

section('Цены — цены, а не цитаты');
// В дальней колонке книги стоят цитаты с годом («…Чехов А. П., Мальчики, 1887»),
// и правило «последняя ячейка с цифрой = цена» однажды утащило такую цитату в
// цену. Теперь цена — ячейка целиком из числа.
const allItems = menu.flatMap((g) => g.categories.flatMap((c) => c.items));
const badPrices = allItems.filter((i) => !/^[\d  ]+([./][\d  ]+)* ₽$/.test(i.price));
eq(badPrices.map((i) => `${i.name}: ${i.price}`).join(' / '), '', 'у всех 178 позиций цена — число с ₽');
eq(allItems.find((i) => i.name === 'Cross Keys Botanical Gin')?.price, '580 ₽', 'Cross Keys Botanical Gin — 580 ₽ (рядом цитата Чехова)');
eq(allItems.find((i) => i.name === 'Том-Ям')?.price, '330 ₽', 'Том-Ям — 330 ₽ (рядом цитата Гоголя)');

// ── 3. Санитайзер API: карта переживает сохранение ─────────────────────────
section('sanitizeBarMenu (сохранение через API)');
const clean = sanitizeBarMenu({ menu, stories });
eq(clean.menu.length, menu.length, 'групп столько же');
eq(clean.menu.reduce((n, g) => n + g.categories.length, 0), report.categories, 'разделов столько же');
eq(clean.menu.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.items.length, 0), 0), report.items, 'позиций столько же');
const cleanBar = clean.menu.find((g) => g.title === 'Карта Бара');
eq(cleanBar.categories.filter((c) => c.parent === 'Виски').map((c) => c.title).join(' | '),
  WHISKY_KIDS.join(' | '), 'parent пережил санитайзер');

// ── 4. Рендер: маркап /menu и JSON-LD ──────────────────────────────────────
section('Пререндер /menu');
const html = pageHtml(clean.menu);
const missingCards = EXPECTED_BAR.map(([t]) => t).filter((t) => !html.includes(`>${t}</h3>`));
eq(missingCards.join(', '), '', 'все 19 карточек листа «Карта Бара» отрисованы');
eq((html.match(/class="bmn-card__parent">Виски</g) || []).length, 4, 'на 4 карточках подпись надгруппы «Виски»');
const prices = clean.menu.flatMap((g) => g.categories.flatMap((c) => c.items));
ok(prices.every((i) => html.includes(`>${i.name}<`) || html.includes(i.name)), 'все позиции попали в маркап');

section('JSON-LD schema.org/Menu');
const schema = buildSchema(clean.menu);
const whiskySection = schema.hasMenuSection.find((s) => s.name === 'Виски');
ok(!!whiskySection, '«Виски» — секция схемы');
eq((whiskySection?.hasMenuSection || []).map((s) => s.name).join(' | '), WHISKY_KIDS.join(' | '),
  'подразделы вложены в «Виски» через hasMenuSection');
ok(schema.hasMenuSection.some((s) => s.name === 'Джин' && s.hasMenuItem?.length === 11),
  '«Джин» — секция верхнего уровня со своими позициями');
const schemaItems = (JSON.stringify(schema).match(/"@type":"MenuItem"/g) || []).length;
eq(schemaItems, report.items, 'в схему попали все позиции');

// ── 5. Незнакомая надгруппа: молчком не схлопываем, предупреждаем ──────────
// Список известных надгрупп в excelImport.js намеренно короткий («Виски»).
// Если в обновлённой книге появится новая — угадывать её границы нечем, и
// парсер обязан сказать об этом владельцу, а не собрать дерево наугад.
section('Незнакомая надгруппа — предупреждение, а не догадка');
const head = (r, text, weight) => ({ r, cells: { A: text }, weight });
const line = (r, name, price) => ({ r, cells: { A: name, B: '40 мл.', C: price }, weight: 11 });
const warns = [];
const synth = buildSheet({
  name: 'Тестовый лист',
  rows: [
    head(1, 'Тестовая карта', 16),
    head(2, 'Ром', 11), line(3, 'Havana Club', '500'),
    head(4, 'Бренди мира', 12), // надгруппа, которой нет в списке
    head(5, 'Франция', 11), line(6, 'Cognac X', '700'),
    head(7, 'Джин', 11), line(8, 'Beefeater', '450'),
  ],
}, warns);
eq(synth.length, 1, 'лист с незнакомой надгруппой сводится в одну группу');
eq(synth[0].categories.map((c) => `${c.title}${c.parent ? `→${c.parent}` : ''}`).join(' | '),
  'Ром | Франция | Джин', 'разделы остаются плоскими, вложенность не выдумывается');
eq(warns.length, 1, 'владелец предупреждён ровно один раз', warns.join(' / '));
ok((warns[0] || '').includes('Бренди мира'), 'в предупреждении названа сама надгруппа', warns[0]);

section('Надгруппа без дочерних разделов — обычная категория');
// Если в новой книге под «Виски» пойдут сразу позиции, а не Шотландия с
// Ирландией, третий уровень не нужен: это просто раздел со своими позициями.
const warns2 = [];
const plain = buildSheet({
  name: 'Тестовый лист',
  rows: [
    head(1, 'Тестовая карта', 16),
    head(2, 'Ром', 11), line(3, 'Havana Club', '500'),
    head(4, 'Виски', 12), line(5, 'Ardbeg 10', '900'), line(6, 'Talisker 10', '850'),
  ],
}, warns2);
eq(plain[0]?.categories.map((c) => `${c.title}:${c.items.length}${c.parent ? `→${c.parent}` : ''}`).join(' | '),
  'Ром:1 | Виски:2', '«Виски» с позициями под ним — обычный раздел, позиции не уехали в «Ром»');

console.log(failed ? `\n${failed} CHECKS FAILED` : '\nALL SCENARIOS PASS');
process.exit(failed ? 1 : 0);
