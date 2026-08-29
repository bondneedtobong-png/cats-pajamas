// Раскладка барной карты по страницам книги-разворота (секция «Меню»).
// Чистая функция без React и DOM — её гоняет devtools/menu_book_test.mjs на
// реальной книге владельца.
//
// Правила раскладки (переписаны 2026-08-30):
//   • книга ОДНА и НЕПРЕРЫВНАЯ: страницы идут подряд по всему дереву меню
//     (группы → категории → подкатегории), в том порядке, в каком карта
//     лежит в данных (порядок листов и разделов файла владельца; переставить
//     можно в админке стрелками ↑/↓);
//   • ЛИСТ НАБИВАЕТСЯ ДО КОНЦА. Раздел больше НЕ начинается обязательно с
//     новой страницы: кончились позиции — тут же, на том же листе, начинается
//     следующий раздел со своим заголовком. Раньше было наоборот (каждый
//     раздел с чистого листа) и позиции раскладывались ПОРОВНУ на минимальное
//     число страниц — из-за этого низ каждого листа стоял пустым, а 21 раздел
//     давал жёсткий пол в 21 страницу, сколько ни уплотняй набор;
//   • единственное исключение — заголовок не бросаем в самом низу листа: если
//     под ним не помещается хотя бы MIN_AFTER_HEAD позиций, раздел уезжает на
//     следующую страницу целиком;
//   • «О разделе» печатаем на первой странице категории, цитата-афоризм — на
//     последней (как в логобуке);
//   • книга всегда открыта на два листа, поэтому число страниц дополняем до
//     чётного пустым листом.
//
// Ёмкость листа меряется в «позициях»: одна ЕДИНИЦА — позиция с составом в
// одну строку (название + состав + строка «объём ⋯ цена»). Всё остальное на
// листе выражено в долях этой единицы — коэффициенты ниже сняты с реальной
// вёрстки (menubook.css, 1600×900). Правишь кегли или отступы в CSS — сверь
// и эти числа, иначе позиции полезут за нижнюю рамку (лист режет по
// overflow: hidden).
const U_ORIGIN_LINE = 0.25; // каждая строка состава сверх первой
const U_NO_ORIGIN   = 0.25; // на столько КОРОЧЕ позиция вообще без состава
const U_HEAD        = 0.60; // название раздела
const U_PARENT      = 0.24; // строка надгруппы над названием («ВИСКИ»)
const U_UNIT        = 0.33; // подпись объёма под названием
const U_CONT        = 0.30; // строка «… · продолжение»
const U_STORY_LINE  = 0.40; // одна строка блока «О разделе»
const U_QUOTE_LINE  = 0.36; // одна строка цитаты
const U_QUOTE_SIGN  = 0.63; // рукописная подпись под цитатой + отбивка блока

/** Сколько позиций обязано поместиться под заголовком, иначе он не начинается. */
const MIN_AFTER_HEAD = 2;

/** Символов в строке — оценка по ширине листа; см. bookMetrics в MenuBook.jsx. */
const DEFAULT_CPL = { origin: 62, story: 52, quote: 52 };

const slug = (s) => String(s).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/(^-|-$)/g, '');

/** Ключ раздела для навигации-пузырей: группа + название (названия совпадают между группами). */
export const catKey = (groupId, title) => `${groupId}/${slug(title)}`;
/** Ключ надгруппы («Виски») — по ней пузырь ведёт на первый её раздел. */
export const parentKey = (groupId, title) => `${groupId}/^${slug(title)}`;

const linesOf = (text, cpl) => Math.max(1, Math.ceil(String(text || '').length / Math.max(10, cpl)));

/** Во сколько «позиций» обходится одна позиция карты. */
function itemCost(item, cpl) {
  if (!item.origin) return 1 - U_NO_ORIGIN;
  return 1 + (linesOf(item.origin, cpl.origin) - 1) * U_ORIGIN_LINE;
}

/** Во сколько обходится шапка раздела (с надгруппой и подписью объёма). */
const headCost = (cat) => U_HEAD + (cat.parent ? U_PARENT : 0) + (cat.unit ? U_UNIT : 0);

const storyCost = (story, cpl) => (story ? linesOf(story, cpl.story) * U_STORY_LINE : 0);

/** Цитата-афоризм: длина текста → строки, плюс подпись. */
const quoteCost = (quote, cpl) =>
  (quote ? linesOf(quote.text, cpl.quote ?? cpl.story) * U_QUOTE_LINE + U_QUOTE_SIGN : 0);

/**
 * Дерево меню → страницы книги.
 * @param menu     [{ id, title, categories: [{ title, parent?, unit?, items, quote? }] }]
 * @param stories  { [название раздела]: 'текст «О разделе»' }
 * @param perPage  ёмкость листа в «позициях» (см. выше)
 * @param cpl      { origin, story, quote } — символов в строке для оценки переносов
 * @returns { pages, spreads, jumps } — jumps: Map<ключ раздела, номер страницы>
 *
 * Страница: { key, blocks: [ { groupTitle, title, parent, unit, head, story,
 * items, quote } ] } — блоков на листе может быть несколько, это и есть
 * набивка до конца.
 */
export function buildBook(menu, stories = {}, perPage = 6, cpl = DEFAULT_CPL) {
  const cap = Math.max(1, perPage);
  const pages = [];
  const jumps = new Map();
  let used = 0;

  const openPage = () => { pages.push({ key: `p${pages.length}`, blocks: [] }); used = 0; };
  const page = () => pages[pages.length - 1];
  const pushBlock = (block) => { page().blocks.push(block); return block; };
  openPage();

  for (const group of menu || []) {
    for (const cat of group.categories || []) {
      const story = (stories && stories[cat.title]) || '';
      const items = cat.items || [];
      const head = headCost(cat);
      const intro = head + storyCost(story, cpl);

      // Заголовок в самом низу листа — сирота: под ним должно поместиться
      // хотя бы MIN_AFTER_HEAD позиций, иначе раздел начинаем с чистой страницы.
      const probe = items.slice(0, MIN_AFTER_HEAD).reduce((s, it) => s + itemCost(it, cpl), 0);
      if (used > 0 && used + intro + probe > cap) openPage();

      jumps.set(catKey(group.id, cat.title), pages.length - 1);
      // Пузырь надгруппы ведёт на первый её раздел («Виски» → «Шотландия»).
      if (cat.parent) {
        const pk = parentKey(group.id, cat.parent);
        if (!jumps.has(pk)) jumps.set(pk, pages.length - 1);
      }

      const base = {
        groupTitle: group.title,
        title: cat.title,
        parent: cat.parent || '',
        unit: cat.unit || '',
      };
      let block = pushBlock({ ...base, head: true, story, items: [], quote: null });
      used += intro;

      /** Продолжение раздела на следующем листе — с пометкой вместо заголовка. */
      const carryOver = () => {
        openPage();
        block = pushBlock({ ...base, head: false, story: '', items: [], quote: null });
        used += U_CONT;
      };

      for (const item of items) {
        const cost = itemCost(item, cpl);
        if (used + cost > cap && (block.items.length || page().blocks.length > 1)) carryOver();
        block.items.push(item);
        used += cost;
      }

      if (cat.quote) {
        const qc = quoteCost(cat.quote, cpl);
        if (used + qc > cap) carryOver();
        block.quote = cat.quote;
        used += qc;
      }
    }
  }

  // Пустая книга — хотя бы один разворот, иначе не из чего собрать спред.
  if (pages.length === 1 && !pages[0].blocks.length) pages.pop();
  if (pages.length % 2) pages.push(null); // книга всегда открыта на два листа
  if (!pages.length) pages.push(null, null);

  const spreads = [];
  for (let i = 0; i < pages.length; i += 2) spreads.push([pages[i], pages[i + 1]]);

  return { pages, spreads, jumps };
}

/**
 * Дерево меню → список пузырей навигации: плоские разделы и надгруппы со
 * своими детьми. Порядок — как в карте.
 */
export function buildNav(menu) {
  const groups = [];
  for (const group of menu || []) {
    const entries = [];
    let sub = null;
    for (const cat of group.categories || []) {
      if (cat.parent) {
        if (!sub || sub.title !== cat.parent) {
          sub = { type: 'parent', title: cat.parent, key: parentKey(group.id, cat.parent), children: [] };
          entries.push(sub);
        }
        sub.children.push({ type: 'cat', title: cat.title, key: catKey(group.id, cat.title) });
        continue;
      }
      sub = null;
      entries.push({ type: 'cat', title: cat.title, key: catKey(group.id, cat.title) });
    }
    if (entries.length) groups.push({ id: group.id, title: group.title, entries });
  }
  return groups;
}

/** Номер разворота, на котором лежит страница. */
export const spreadOfPage = (pageIndex) => Math.floor(pageIndex / 2);
