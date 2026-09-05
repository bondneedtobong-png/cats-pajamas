// Автопагинация книги-меню по РЕАЛЬНЫМ замерам вёрстки.
//
// Как это работает:
//   1. в живой книге создаётся оффскрин-лист — тот же .mbook__paper того же
//      размера, с теми же CSS-переменными (он лежит ВНУТРИ .mbook, поэтому
//      наследует и токены кегля, и шрифты);
//   2. в него по очереди кладётся разметка каждого раздела — той же функцией
//      blockHTML, которой рисуется настоящая страница (pageMarkup.js);
//   3. с него снимаются высоты: шапка, «О разделе», КАЖДАЯ позиция, цитата,
//      строка «· продолжение», отбивки и свободная высота листа;
//   4. пиксели уходят в packPages (bookSpreads.js), который просто набивает
//      листы, ничего не зная о вёрстке.
//
// Ни одного «столько-то позиций на страницу» в коде нет и быть не может:
// поменяли кегль, поля, шрифт или размер окна — замер даст другие числа сам.
// Правило проекта: правишь menubook.css — здесь править НЕЧЕГО.

import { packPages } from './bookSpreads.js';
import { blockHTML } from './pageMarkup.js';

const px = (v) => (Number.parseFloat(v) || 0);

/**
 * Оффскрин-лист внутри книги: те же классы, тот же размер, те же шрифты.
 * Скрыт visibility, а не display — иначе браузер не считает высоты.
 */
function openMeasurer(host, w, h) {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.className = 'mbook__measure';
  box.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;`
    + `pointer-events:none;width:${w}px;height:${h}px;contain:layout size style;`;
  box.innerHTML = '<div class="mbook__paper mbook__paper--right">'
    + '<div class="mbook__content"></div></div>';
  host.appendChild(box);
  const content = box.querySelector('.mbook__content');
  return {
    content,
    close: () => box.remove(),
  };
}

const H = (el) => (el ? el.getBoundingClientRect().height : 0);

/**
 * Замерить дерево меню и разложить его по страницам.
 *
 * @param menu     дерево карты
 * @param stories  тексты «О разделе»
 * @param host     живой элемент .mbook (нужен ради унаследованных переменных)
 * @param size     { w, h } — реальные размеры одного листа книги
 * @returns { pages, spreads, jumps } либо null, если мерить негде
 */
export function paginateByMeasure(menu, stories, host, size) {
  if (typeof document === 'undefined' || !host || !size?.w || !size?.h) return null;

  const { content, close } = openMeasurer(host, size.w, size.h);
  try {
    const cs = getComputedStyle(content);
    // Свободная высота листа = его внутренняя высота минус поля.
    const cap = content.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
    if (!(cap > 0)) return null;

    // Отбивка между разделами на одном листе: .mbook__sec + .mbook__sec.
    content.innerHTML = '<section class="mbook__sec"></section><section class="mbook__sec"></section>';
    const secGap = px(getComputedStyle(content.children[1]).marginTop);

    const cats = [];
    for (const group of menu || []) {
      for (const cat of group.categories || []) {
        const story = (stories && stories[cat.title]) || '';
        const items = cat.items || [];
        const base = {
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
        };

        if (cat.kind === 'text') {
          // Текстовая страница живёт на отдельном листе — мерить нечего.
          cats.push({ ...base, h: { sec: secGap, head: 0, story: 0, listTop: 0, listGap: 0, cont: 0, quote: 0, items: [] } });
          continue;
        }

        // Раздел целиком, со всеми позициями и цитатой: один reflow на раздел.
        content.innerHTML = blockHTML({ ...base, head: true, quote: cat.quote || null });
        const sec = content.firstElementChild;
        const list = sec.querySelector('.mbook__items');
        const listCs = getComputedStyle(list);
        const quoteEl = sec.querySelector('.mbook__quote');

        // Строку «· продолжение» меряем отдельно: она встаёт вместо шапки.
        const contProbe = document.createElement('p');
        contProbe.className = 'mbook__cont';
        contProbe.textContent = `${cat.title} · продолжение`;
        sec.insertBefore(contProbe, sec.firstChild);

        cats.push({
          ...base,
          h: {
            sec: secGap,
            head: H(sec.querySelector('.mbook__head')),
            story: H(sec.querySelector('.mbook__story')),
            listTop: px(listCs.marginTop),
            listGap: px(listCs.rowGap),
            cont: H(contProbe),
            quote: quoteEl ? H(quoteEl) + px(getComputedStyle(quoteEl).marginTop) : 0,
            items: [...list.children].map(H),
          },
        });
      }
    }

    return packPages(cats, cap);
  } finally {
    close();
  }
}

/** Реальный размер одного листа книги — читаем с живой страницы. */
export function pageSizeOf(host) {
  const paper = host?.querySelector('.mbook__paper');
  if (!paper) return null;
  const r = paper.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : null;
}
