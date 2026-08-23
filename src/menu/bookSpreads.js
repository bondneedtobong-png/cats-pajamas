// Раскладка барной карты по страницам книги-разворота (секция «Меню»).
// Чистая функция без React и DOM — её гоняет devtools/menu_book_test.mjs на
// реальной книге владельца.
//
// Правила раскладки:
//   • книга ОДНА и НЕПРЕРЫВНАЯ: страницы идут подряд по всему дереву меню
//     (группы → категории → подкатегории), в том порядке, в каком карта
//     лежит в данных (порядок листов и разделов файла владельца; переставить
//     можно в админке стрелками ↑/↓);
//   • категория всегда начинается с новой страницы и при длинном списке
//     занимает несколько страниц подряд (второй и следующие листы — без
//     заголовка, как продолжение в бумажном меню); позиции по этим страницам
//     раскладываются поровну, чтобы последний лист не был почти пустым;
//   • «О разделе» печатаем на первой странице категории — она съедает пару
//     позиций, поэтому первая страница короче;
//   • цитата-афоризм — на последней странице категории (как в логобуке);
//   • книга всегда открыта на два листа, поэтому число страниц дополняем до
//     чётного пустым листом.

/** Сколько позиций «стоит» блок «О разделе» на первой странице категории. */
const STORY_COST = 2;

const slug = (s) => String(s).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/(^-|-$)/g, '');

/** Ключ раздела для навигации-пузырей: группа + название (названия совпадают между группами). */
export const catKey = (groupId, title) => `${groupId}/${slug(title)}`;
/** Ключ надгруппы («Виски») — по ней пузырь ведёт на первый её раздел. */
export const parentKey = (groupId, title) => `${groupId}/^${slug(title)}`;

/**
 * Сколько позиций положить на каждую страницу категории. Жадная набивка «по
 * максимуму сверху» оставляла на последнем листе одну позицию посреди пустой
 * страницы, поэтому раскладываем ПОРОВНУ на минимально возможное число
 * страниц, а первой (там ещё текст «О разделе») отдаём меньше — излишек
 * уезжает на следующие, пока там есть место.
 */
function chunkSizes(total, perPage, firstPageCost) {
  const cap0 = Math.max(1, perPage - firstPageCost);
  let n = total <= cap0 ? 1 : 1 + Math.ceil((total - cap0) / perPage);
  for (;;) {
    const base = Math.floor(total / n);
    const rem = total % n;
    const sizes = Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
    let over = Math.max(0, sizes[0] - cap0);
    sizes[0] -= over;
    for (let i = 1; i < n && over > 0; i++) {
      const take = Math.min(perPage - sizes[i], over);
      sizes[i] += take;
      over -= take;
    }
    if (over === 0) return sizes;
    n += 1; // на минимальном числе страниц не поместилось — добавляем лист
  }
}

function chunk(items, perPage, firstPageCost) {
  const sizes = chunkSizes(items.length, perPage, firstPageCost);
  const out = [];
  let i = 0;
  for (const size of sizes) {
    out.push(items.slice(i, i + size));
    i += size;
  }
  return out.length ? out : [[]];
}

/**
 * Дерево меню → страницы книги.
 * @param menu     [{ id, title, categories: [{ title, parent?, unit?, items, quote? }] }]
 * @param stories  { [название раздела]: 'текст «О разделе»' }
 * @param perPage  сколько позиций помещается на страницу (зависит от вьюпорта)
 * @returns { pages, spreads, jumps } — jumps: Map<ключ раздела, номер страницы>
 */
export function buildBook(menu, stories = {}, perPage = 6) {
  const pages = [];
  const jumps = new Map();

  for (const group of menu || []) {
    for (const cat of group.categories || []) {
      const story = (stories && stories[cat.title]) || '';
      const parts = chunk(cat.items || [], perPage, story ? STORY_COST : 0);
      const firstPage = pages.length;

      parts.forEach((items, i) => {
        pages.push({
          key: `${catKey(group.id, cat.title)}#${i}`,
          groupTitle: group.title,
          title: cat.title,
          parent: cat.parent || '',
          unit: cat.unit || '',
          items,
          head: i === 0,                     // заголовок только на первом листе
          story: i === 0 ? story : '',
          quote: i === parts.length - 1 ? (cat.quote || null) : null,
        });
      });

      jumps.set(catKey(group.id, cat.title), firstPage);
      // Пузырь надгруппы ведёт на первый её раздел («Виски» → «Шотландия»).
      if (cat.parent) {
        const pk = parentKey(group.id, cat.parent);
        if (!jumps.has(pk)) jumps.set(pk, firstPage);
      }
    }
  }

  if (pages.length % 2) pages.push(null); // книга всегда открыта на два листа
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
