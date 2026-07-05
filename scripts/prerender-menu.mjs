// Пререндер /menu при сборке (SEO): Яндекс плохо исполняет JS, а барная карта —
// статичные данные (src/menu/barMenuData.js), поэтому дешевле всего собрать
// готовый dist/menu/index.html со всем текстом, метой и JSON-LD прямо здесь.
// nginx через try_files отдаст его по адресу /menu, дальше React смонтируется
// поверх (createRoot перерисует #root тем же самым маркапом — стили совпадают,
// глазу перерисовка не видна). Запускается из `npm run build`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BAR_MENU } from '../src/menu/barMenuData.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = join(root, 'dist', 'index.html');

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// ─── SVG-орнаменты — те же, что рисует BarMenuPage.jsx ──────────────────────
function fanSvg(flip) {
  let rays = '';
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    const x = (44 - 36 * Math.cos(a)).toFixed(1);
    const y = (42 - 36 * Math.sin(a)).toFixed(1);
    rays += `<line x1="44" y1="42" x2="${x}" y2="${y}"></line>`;
  }
  return `<svg class="bmn-fan${flip ? ' bmn-fan--flip' : ''}" viewBox="0 0 88 44" width="66" height="33" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3">${rays}<path d="M8 42 A36 36 0 0 1 80 42"></path><path d="M32 42 A12 12 0 0 1 56 42" fill="var(--bmn-card)"></path></svg>`;
}
function cornerSvg() {
  let rays = '';
  for (let i = 0; i <= 3; i++) {
    const a = (Math.PI / 2) * (i / 3);
    const x = (2 + 26 * Math.cos(a)).toFixed(1);
    const y = (2 + 26 * Math.sin(a)).toFixed(1);
    rays += `<line x1="2" y1="2" x2="${x}" y2="${y}"></line>`;
  }
  return `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">${rays}<path d="M28 2 A26 26 0 0 1 2 28"></path></svg>`;
}

// ─── Маркап страницы — зеркало BarMenuPage.jsx (те же классы) ───────────────
function itemHtml(item, unit) {
  const volume = item.volume ?? unit ?? '';
  return `<li class="bmn-item"><span class="bmn-item__name">${esc(item.name)}</span>${item.origin ? `<span class="bmn-item__origin">${esc(item.origin)}</span>` : ''}<span class="bmn-item__line"><span class="bmn-item__vol">${esc(volume)}</span><span class="bmn-item__leader" aria-hidden="true"></span><span class="bmn-item__price">${esc(item.price)}</span></span></li>`;
}

function cardHtml(cat) {
  const corners = `<span class="bmn-corner bmn-corner--tl">${cornerSvg()}</span><span class="bmn-corner bmn-corner--tr">${cornerSvg()}</span><span class="bmn-corner bmn-corner--bl">${cornerSvg()}</span><span class="bmn-corner bmn-corner--br">${cornerSvg()}</span>`;
  const fans = `<span class="bmn-card__fan bmn-card__fan--top">${fanSvg(true)}</span><span class="bmn-card__fan bmn-card__fan--bottom">${fanSvg(false)}</span>`;
  const quote = cat.quote
    ? `<figure class="bmn-quote"><blockquote class="bmn-quote__text">«${esc(cat.quote.text)}»</blockquote><figcaption class="bmn-quote__sign">${esc(cat.quote.author)}</figcaption></figure>`
    : '';
  return `<article class="bmn-card"><div class="bmn-card__inner">${corners}${fans}<h3 class="bmn-card__title">${esc(cat.title)}</h3>${cat.unit ? `<p class="bmn-card__unit">${esc(cat.unit)}</p>` : ''}<ul class="bmn-card__list">${cat.items.map(i => itemHtml(i, cat.unit)).join('')}</ul>${quote}</div></article>`;
}

function pageHtml() {
  const nav = BAR_MENU.map(g => `<a class="bmn-nav__chip" href="#bmn-${g.id}">${esc(g.title)}</a>`).join('');
  const groups = BAR_MENU.map(g =>
    `<section id="bmn-${g.id}" class="bmn-group"><h2 class="bmn-group__title">${esc(g.title)}</h2><div class="bmn-grid">${g.categories.map(cardHtml).join('')}</div></section>`
  ).join('');
  return `<div class="bmn-root"><header class="bmn-header"><a class="bmn-header__logo" href="/"><img src="/uploads/logo-icon.svg" alt="" style="height:24px;width:auto;display:block"><span class="bmn-header__logo-text">CAT'S PAJAMAS</span></a><div class="bmn-header__divider"></div><h1 class="bmn-header__title">БАРНАЯ КАРТА</h1><div style="flex:1"></div><a class="bmn-header__back" href="/">← На сайт</a></header><nav class="bmn-nav" aria-label="Разделы меню">${nav}</nav><main class="bmn-main">${groups}<p class="bmn-footnote">Цены действительны на момент публикации — уточняйте у барменов. Чрезмерное употребление алкоголя вредит вашему здоровью.</p></main></div>`;
}

// ─── JSON-LD schema.org/Menu — цены из данных, без выдумок ──────────────────
const priceOf = (p) => (String(p).split('/')[0].match(/[\d\s]+/) || [''])[0].replace(/\s/g, '');
const menuSchema = {
  '@context': 'https://schema.org',
  '@type': 'Menu',
  name: "Барная карта The Cat's Pajamas Club",
  url: 'https://cats-pajamas.ru/menu/',
  inLanguage: 'ru',
  hasMenuSection: BAR_MENU.flatMap(g => g.categories.map(c => ({
    '@type': 'MenuSection',
    name: c.title,
    hasMenuItem: c.items.map(i => ({
      '@type': 'MenuItem',
      name: i.name,
      ...(i.origin ? { description: i.origin } : {}),
      offers: { '@type': 'Offer', priceCurrency: 'RUB', price: priceOf(i.price) },
    })),
  }))),
};

// ─── Сборка dist/menu/index.html из dist/index.html ─────────────────────────
const TITLE = "Барная карта — The Cat's Pajamas Club, джаз-бар в Самаре";
const DESC = "Полное меню бара: авторские коктейли, вина, виски, ром, джин, настойки и закуски с ценами. Джаз-бар The Cat's Pajamas Club, Самара, ул. Куйбышева, 100.";

let html = readFileSync(distIndex, 'utf8');
html = html
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${TITLE}</title>`)
  .replace(/(<meta name="description" content=")[^"]*(")/, `$1${DESC}$2`)
  // canonical со слэшем: nginx 301-ит /menu → /menu/, canonical не должен вести на редирект
  .replace(/(<link rel="canonical" href=")[^"]*(")/, '$1https://cats-pajamas.ru/menu/$2')
  .replace(/(<meta property="og:url" content=")[^"]*(")/, '$1https://cats-pajamas.ru/menu/$2')
  .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${TITLE}$2`)
  .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${DESC}$2`)
  .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${TITLE}$2`)
  .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${DESC}$2`)
  .replace('</head>', `<script type="application/ld+json">${JSON.stringify(menuSchema)}</script>\n</head>`)
  .replace('<div id="root"></div>', `<div id="root">${pageHtml()}</div>`);

mkdirSync(join(root, 'dist', 'menu'), { recursive: true });
writeFileSync(join(root, 'dist', 'menu', 'index.html'), html);
const items = BAR_MENU.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.items.length, 0), 0);
console.log(`[prerender-menu] dist/menu/index.html: ${BAR_MENU.length} групп, ${items} позиций, ${(html.length / 1024).toFixed(0)} КБ`);
