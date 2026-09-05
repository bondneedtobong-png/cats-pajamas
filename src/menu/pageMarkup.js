// ЕДИНЫЙ ИСТОЧНИК РАЗМЕТКИ листа книги-меню.
//
// Зачем строка HTML, а не JSX: этой же разметкой автопагинация (paginate.js)
// набивает оффскрин-лист и МЕРЯЕТ реальные высоты. Если бы страница рисовалась
// в React, а замерялась «похожей» копией, две разметки неизбежно разъехались бы
// — ровно эта болезнь и была раньше, только вместо копии разметки в коде жили
// коэффициенты («заголовок ≈ 0.60 позиции»), подогнанные под конкретный
// список. Одна функция на рендер и на замер = разойтись физически нечему.
//
// Страницы книги — чистый текст без интерактива, поэтому React вставляет их
// через dangerouslySetInnerHTML. Контент правит админ, поэтому экранируем всё.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Длинное тире в рукописном Jar Binks рендерится жирной чертой и рвёт строку
// (известная беда шрифта, см. CLAUDE.md). «О разделе» набрано именно им, а
// тексты приходят из админки — меняем тире на запятую при выводе.
export const handwritten = (s) => String(s || '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');

/** Цитату оборачиваем в «ёлочки», только если автор не поставил их сам. */
const quoted = (t) => (String(t).trim().startsWith('«') ? String(t) : `«${t}»`);

/** Строка «объём ⋯⋯ цена». Нет ни того, ни другого — строки нет вовсе
 *  (разделы с единой ценой в шапке: «КОКТЕЙЛИ · 880 ₽»). */
function priceLineHTML(item, block) {
  const vol = item.volume ?? block.unit ?? '';
  const price = item.price ?? '';
  if (!vol && !price) return '';
  return `<span class="mbook__item-line">`
    + `<span class="mbook__item-vol">${esc(vol)}</span>`
    + '<span class="mbook__item-leader" aria-hidden="true"></span>'
    + `<span class="mbook__item-price">${esc(price)}</span>`
    + '</span>';
}

/** Одна позиция карты — <li>. Единица измерения автопагинации. */
export function itemHTML(item, block) {
  return '<li class="mbook__item">'
    + `<span class="mbook__item-name">${esc(item.name)}</span>`
    + (item.origin ? `<span class="mbook__item-origin">${esc(item.origin)}</span>` : '')
    + priceLineHTML(item, block)
    + '</li>';
}

/** Шапка раздела: надгруппа, название, подпись (объём или единая цена). */
export function headHTML(block) {
  const sub = block.subtitle || block.unit || '';
  return '<header class="mbook__head">'
    + (block.parent ? `<p class="mbook__parent">${esc(block.parent)}</p>` : '')
    + `<h3 class="mbook__title">${esc(block.title)}</h3>`
    + (sub ? `<p class="mbook__unit">${esc(sub)}</p>` : '')
    + '</header>';
}

/** Страница-текст: приветствие и «мы в сети» — полноценные развороты меню
 *  без списка позиций, текст по центру листа. */
function textBlockHTML(block) {
  const paras = String(block.text || '').split(/\n{2,}/).filter(Boolean);
  return '<section class="mbook__sec mbook__sec--text">'
    + `<h3 class="mbook__title">${esc(block.title)}</h3>`
    + `<div class="mbook__prose">${paras.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`
    + (block.sign ? `<p class="mbook__sign">${esc(block.sign)}</p>` : '')
    + (block.links?.length
      ? `<p class="mbook__links">${block.links.map((l) => esc(l)).join(' · ')}</p>`
      : '')
    + '</section>';
}

/**
 * Блок листа целиком. Блоков на листе может быть несколько — лист набивается
 * до конца, и когда позиции раздела кончились, тут же начинается следующий.
 * @param block { kind?, title, parent, unit, subtitle, head, story, items, quote }
 */
export function blockHTML(block) {
  if (block.kind === 'text') return textBlockHTML(block);
  const q = block.quote;
  return '<section class="mbook__sec">'
    + (block.head ? headHTML(block) : `<p class="mbook__cont">${esc(block.title)} · продолжение</p>`)
    + (block.story ? `<p class="mbook__story">${esc(handwritten(block.story))}</p>` : '')
    + `<ul class="mbook__items">${block.items.map((it) => itemHTML(it, block)).join('')}</ul>`
    + (q
      ? '<figure class="mbook__quote">'
        + `<blockquote class="mbook__quote-text">${esc(quoted(q.text))}</blockquote>`
        + (q.author ? `<figcaption class="mbook__quote-sign">${esc(q.author)}</figcaption>` : '')
        + '</figure>'
      : '')
    + '</section>';
}

/** Весь лист. */
export const pageHTML = (page) => (page ? page.blocks.map(blockHTML).join('') : '');
