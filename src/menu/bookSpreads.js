// Раскладка барной карты по страницам книги-разворота (секция «Меню»).
// Чистые функции без React и DOM — их гоняет devtools/menu_book_test.mjs.
//
// Правила раскладки:
//   • книга ОДНА и НЕПРЕРЫВНАЯ: страницы идут подряд по всему дереву меню
//     (группы → разделы → подразделы) в том порядке, в каком карта лежит в
//     данных (порядок из barMenuData.js; переставить можно в админке ↑/↓);
//   • ЛИСТ НАБИВАЕТСЯ ДО КОНЦА: кончились позиции раздела — тут же, на том же
//     листе, начинается следующий со своим заголовком;
//   • заголовок не бросаем в самом низу листа: если под ним не помещается
//     хотя бы MIN_AFTER_HEAD позиций, раздел уезжает на следующую страницу;
//   • раздел kind:'text' (приветствие, «мы в сети») всегда занимает лист
//     целиком — это полноценные развороты меню, просто без списка;
//   • «О разделе» печатаем на первой странице раздела, цитата — на последней;
//   • книга всегда открыта на два листа, поэтому число страниц дополняем до
//     чётного пустым листом.
//
// ⚠️ ГЛАВНОЕ ОТЛИЧИЕ ОТ СТАРОЙ ВЕРСИИ (2026-09-05): packPages больше НИЧЕГО
// не знает о вёрстке. Он получает готовые ВЫСОТЫ элементов и ёмкость листа в
// тех же единицах — и просто набивает. Высоты приходят из paginate.js, где их
// МЕРЯЕТ браузер на оффскрин-листе реального размера (getBoundingClientRect).
// Раньше здесь жили коэффициенты вида «заголовок ≈ 0.60 позиции», снятые с
// вёрстки руками: любая правка кегля или полей в CSS молча ломала раскладку —
// низ листа пустовал либо позиции резались по overflow: hidden.
//
// buildBook ниже — ОЦЕНОЧНЫЙ путь для среды без DOM (SSR-пререндер /menu,
// первый кадр до замера, юнит-тесты). Он собирает те же «высоты» из грубых
// коэффициентов и зовёт тот же packPages, поэтому правила раскладки описаны
// ровно в одном месте.

/** Сколько позиций обязано поместиться под заголовком, иначе он не начинается. */
export const MIN_AFTER_HEAD = 2;

const slug = (s) => String(s).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/(^-|-$)/g, '');

/** Ключ раздела для навигации-пузырей: группа + название (названия повторяются между группами). */
export const catKey = (groupId, title) => `${groupId}/${slug(title)}`;
/** Ключ надгруппы («Виски») — по ней пузырь ведёт на первый её раздел. */
export const parentKey = (groupId, title) => `${groupId}/^${slug(title)}`;

/** Номер разворота, на котором лежит страница. */
export const spreadOfPage = (pageIndex) => Math.floor(pageIndex / 2);

/**
 * Набивка листов из измеренных разделов.
 *
 * @param cats  [{ groupId, title, parent, unit, subtitle, kind, text, sign,
 *                 links, story, items,
 *                 h: { sec, head, story, listTop, listGap, cont, quote,
 *                      items: [высота каждой позиции] } }]
 * @param cap   свободная высота листа в тех же единицах, что и h.*
 * @returns { pages, spreads, jumps }
 */
export function packPages(cats, cap) {
  const limit = Math.max(1, cap);
  const pages = [];
  const jumps = new Map();
  let used = 0;

  const openPage = () => { pages.push({ key: `p${pages.length}`, blocks: [] }); used = 0; };
  const page = () => pages[pages.length - 1];
  const push = (block) => { page().blocks.push(block); return block; };
  openPage();

  for (const cat of cats) {
    const h = cat.h;
    const base = {
      groupTitle: cat.groupTitle,
      title: cat.title,
      parent: cat.parent || '',
      unit: cat.unit || '',
      subtitle: cat.subtitle || '',
    };

    /** Раздел начинается на текущей странице — запомнить её для пузырей. */
    const markJump = () => {
      jumps.set(catKey(cat.groupId, cat.title), pages.length - 1);
      if (cat.parent) {
        const pk = parentKey(cat.groupId, cat.parent);
        if (!jumps.has(pk)) jumps.set(pk, pages.length - 1);
      }
    };

    // Страница-текст: свой лист целиком, следующий раздел начинает новый.
    if (cat.kind === 'text') {
      if (page().blocks.length) openPage();
      markJump();
      push({
        ...base, kind: 'text', head: true, items: [],
        text: cat.text || '', sign: cat.sign || '', links: cat.links || [],
      });
      openPage();
      continue;
    }

    const items = cat.items || [];
    const heights = h.items || [];
    const body = h.head + (cat.story ? h.story : 0) + (items.length ? h.listTop : 0);
    // Заголовок в самом низу листа — сирота: под ним должно поместиться хотя бы
    // MIN_AFTER_HEAD позиций, иначе раздел начинаем с чистой страницы.
    const probe = heights.slice(0, MIN_AFTER_HEAD)
      .reduce((s, ih, i) => s + ih + (i ? h.listGap : 0), 0);
    // Второй и следующий разделы на листе отбиваются от предыдущего.
    let gapBefore = page().blocks.length ? h.sec : 0;
    if (used > 0 && used + gapBefore + body + probe > limit) { openPage(); gapBefore = 0; }

    markJump();
    let block = push({ ...base, head: true, story: cat.story || '', items: [], quote: null });
    used += gapBefore + body;

    /** Продолжение раздела на следующем листе — с пометкой вместо заголовка. */
    const carryOver = () => {
      openPage();
      block = push({ ...base, head: false, story: '', items: [], quote: null });
      used = h.cont + h.listTop;
    };

    items.forEach((item, i) => {
      const ih = heights[i] ?? 0;
      let cost = ih + (block.items.length ? h.listGap : 0);
      if (used + cost > limit && (block.items.length || page().blocks.length > 1)) {
        carryOver();
        cost = ih;
      }
      block.items.push(item);
      used += cost;
    });

    if (cat.quote) {
      if (used + h.quote > limit) carryOver();
      block.quote = cat.quote;
      used += h.quote;
    }
  }

  // Пустая книга — хотя бы один разворот, иначе не из чего собрать спред.
  while (pages.length && !pages[pages.length - 1].blocks.length) pages.pop();
  if (pages.length % 2) pages.push(null); // книга всегда открыта на два листа
  if (!pages.length) pages.push(null, null);

  const spreads = [];
  for (let i = 0; i < pages.length; i += 2) spreads.push([pages[i], pages[i + 1]]);

  return { pages, spreads, jumps };
}

/* ── Оценочный путь для среды без DOM ────────────────────────────────────── */

// Условная «единица» — высота базовой позиции (название + состав в одну строку
// + строка «объём ⋯ цена»). Числа грубые НАРОЧНО: этот путь работает только
// там, где мерить нечем (SSR, тесты, первый кадр). В браузере его результат
// живёт доли секунды и заменяется измеренным.
const U = 100;
const EST = {
  sec: 0.22 * U,
  head: 0.60 * U,
  parent: 0.24 * U,
  unit: 0.33 * U,
  cont: 0.30 * U,
  storyLine: 0.40 * U,
  quoteLine: 0.36 * U,
  quoteSign: 0.63 * U,
  listTop: 0.08 * U,
  listGap: 0.05 * U,
  originLine: 0.25 * U,
  noOrigin: -0.25 * U,
};

/** Символов в строке — оценка по ширине листа; см. bookMetrics в paginate.js. */
const DEFAULT_CPL = { origin: 62, story: 52, quote: 52 };

const linesOf = (text, cpl) => Math.max(1, Math.ceil(String(text || '').length / Math.max(10, cpl)));

/**
 * Дерево меню → страницы книги ОЦЕНОЧНО, без DOM.
 * @param menu     [{ id, title, categories: [...] }]
 * @param stories  { [название раздела]: 'текст «О разделе»' }
 * @param perPage  ёмкость листа в «позициях»
 * @param cpl      { origin, story, quote } — символов в строке
 */
export function buildBook(menu, stories = {}, perPage = 6, cpl = DEFAULT_CPL) {
  const cats = [];
  for (const group of menu || []) {
    for (const cat of group.categories || []) {
      const story = (stories && stories[cat.title]) || '';
      const items = cat.items || [];
      cats.push({
        groupId: group.id,
        groupTitle: group.title,
        title: cat.title,
        parent: cat.parent || '',
        unit: cat.unit || '',
        subtitle: cat.subtitle || '',
        kind: cat.kind || '',
        text: cat.text || '',
        sign: cat.sign || '',
        links: cat.links || [],
        story,
        items,
        quote: cat.quote || null,
        h: {
          sec: EST.sec,
          head: EST.head + (cat.parent ? EST.parent : 0) + (cat.subtitle || cat.unit ? EST.unit : 0),
          story: story ? linesOf(story, cpl.story) * EST.storyLine : 0,
          listTop: EST.listTop,
          listGap: EST.listGap,
          cont: EST.cont,
          quote: cat.quote
            ? linesOf(cat.quote.text, cpl.quote ?? cpl.story) * EST.quoteLine + EST.quoteSign
            : 0,
          items: items.map((it) => (it.origin
            ? U + (linesOf(it.origin, cpl.origin) - 1) * EST.originLine
            : U + EST.noOrigin)),
        },
      });
    }
  }
  return packPages(cats, Math.max(1, perPage) * U);
}

/**
 * Дерево меню → список пузырей навигации: плоские разделы и надгруппы со
 * своими детьми. Порядок — как в карте. Разделы с nav: false (приветствие,
 * «мы в сети») пузыря не дают: это страницы книги, а не разделы карты.
 */
export function buildNav(menu) {
  const groups = [];
  for (const group of menu || []) {
    const entries = [];
    let sub = null;
    for (const cat of group.categories || []) {
      if (cat.nav === false || cat.kind === 'text') { sub = null; continue; }
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
