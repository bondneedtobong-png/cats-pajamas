// Пререндер главной (SEO): сырой HTML главной — пустой <div id="root">, поэтому
// Яндекс (плохо исполняет JS) не видит ни «джаз-бар в Самаре», ни легенду с
// «Пижама Кота», ни контакты. Зашиваем статичный семантичный SEO-снапшот прямо
// в #root: h1/легенда/контакты/ссылки. При загрузке createRoot очищает #root и
// монтирует книгу поверх (createRoot, не hydrate — рассинхрона нет). Блок
// оформлен тёмным сплэшем, чтобы кратким мельком на медленном коннекте
// выглядел как интро, а не сломанная вёрстка.
//
// ВАЖНО: запускать ПОСЛЕ scripts/prerender-menu.mjs — тот читает чистый
// dist/index.html (пустой #root) и пишет dist/menu/index.html; если заполнить
// #root раньше, у /menu пропадёт пререндер. См. порядок в package.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { translations } from '../src/data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = join(root, 'dist', 'index.html');
const tx = translations.ru;

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const paras = (Array.isArray(tx.aboutText) ? tx.aboutText : [tx.aboutText])
  .map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('');

// Тёмный сплэш во весь экран; виден только до монтирования React.
const S = {
  wrap: 'position:fixed;inset:0;overflow:auto;background:#0C0A18;color:#F2EDE4;'
      + "font-family:'Avenir Next',system-ui,sans-serif;line-height:1.7;"
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'text-align:center;padding:40px 24px;gap:8px',
  h1: "font-family:'Baskerville',Georgia,serif;font-size:32px;margin:0;color:#F2EDE4",
  sub: 'color:#D4A843;letter-spacing:1px;margin:0 0 6px',
  quote: "font-style:italic;color:#D4A843;font-size:19px;margin:10px 0 18px",
  h2: "font-family:'Baskerville',Georgia,serif;font-size:13px;letter-spacing:2px;"
    + 'text-transform:uppercase;color:#9B5DE5;margin:24px 0 10px',
  body: 'max-width:760px;color:rgba(242,237,228,0.85)',
  link: 'color:#D4A843;text-decoration:none;border:1px solid rgba(212,168,67,0.4);'
      + 'border-radius:999px;padding:9px 18px;margin:6px',
};

const block = `<div id="seo-home" style="${S.wrap}">
<header>
<h1 style="${S.h1}">The Cat's Pajamas Club <span style="color:#D4A843">«Пижама Кота»</span></h1>
<p style="${S.sub}">Джаз-бар в Самаре · ${esc(tx.heroSub)}</p>
<p style="margin:0">${esc(tx.heroTagline)}</p>
</header>
<section style="${S.body}">
<h2 style="${S.h2}">${esc(tx.aboutLabel)}</h2>
<p style="${S.quote}">${esc(tx.aboutQuote)}</p>
${paras}
</section>
<section style="${S.body}">
<h2 style="${S.h2}">${esc(tx.contactsTitle)}</h2>
<p style="margin:0 0 6px"><strong>${esc(tx.addressLabel)}:</strong> ${esc(tx.address)}</p>
<p style="margin:0 0 6px"><strong>${esc(tx.hoursLabel)}:</strong> ${esc(tx.daysWeek)} 17:00–02:00 · ${esc(tx.daysWend)} 16:00–04:00</p>
<p style="margin:0 0 6px"><strong>${esc(tx.phoneLabel)}:</strong> <a style="color:#D4A843;text-decoration:none" href="tel:+79084180009">+7 (908) 418-00-09</a></p>
<p style="margin:6px 0 0"><a style="color:#D4A843" href="https://yandex.com/maps/org/pizhama_kota/36093402806/">Пижама Кота на Яндекс.Картах</a></p>
</section>
<nav style="margin-top:20px">
<a style="${S.link}" href="/menu/">Барная карта</a>
<a style="${S.link}" href="/booking">Забронировать стол</a>
</nav>
</div>`;

let html = readFileSync(distIndex, 'utf8');
if (!html.includes('<div id="root"></div>')) {
  console.warn('[prerender-home] пустой <div id="root"></div> не найден — пропускаю (уже заполнен?)');
  process.exit(0);
}
html = html.replace('<div id="root"></div>', `<div id="root">${block}</div>`);
writeFileSync(distIndex, html);
console.log(`[prerender-home] dist/index.html: SEO-снапшот главной зашит (${(html.length / 1024).toFixed(0)} КБ)`);
