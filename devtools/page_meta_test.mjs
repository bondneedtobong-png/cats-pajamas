import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = new URL(process.argv[2] || 'http://127.0.0.1:4173');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const browser = await chromium.launch();
try {
 const page = await browser.newPage();
 await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { menu: [], stories: {}, members: [], events: [] } });
  if (url.origin !== base.origin && ['http:', 'https:'].includes(url.protocol)) return route.abort();
  return route.continue();
 });
 async function verify(path, title, noindex = false) {
  await page.waitForFunction(expected => document.title.includes(expected), title);
  const meta = await page.evaluate(() => ({title: document.title, description: document.querySelector('meta[name="description"]').content, canonical: document.querySelector('link[rel="canonical"]').href, ogTitle: document.querySelector('meta[property="og:title"]').content, ogDescription: document.querySelector('meta[property="og:description"]').content, ogUrl: document.querySelector('meta[property="og:url"]').content, robots: document.querySelector('meta[name="robots"]')?.content, counts: ['title', 'meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:title"]'].map(s => document.head.querySelectorAll(s).length)}));
  assert.equal(meta.canonical, `https://cats-pajamas.ru${path}`);
  assert.equal(meta.ogUrl, meta.canonical);
  assert.equal(meta.ogTitle, meta.title);
  assert.equal(meta.ogDescription, meta.description);
  assert.deepEqual(meta.counts, [1,1,1,1]);
  assert.equal(Boolean(meta.robots?.includes('noindex')), noindex);
  if (path === '/no-such-page') {
   assert(meta.description.startsWith('Такой страницы нет.'));
   assert(!meta.description.includes('авторский коктейль-бар'));
   assert.equal(await page.locator('meta[name="twitter:description"]').getAttribute('content'), meta.description);
  }
 }
 // Critical regression: entry HTML has menu metadata before React mounts.
 await page.goto(new URL('/menu/', base).href);
 await verify('/menu/', 'Барная карта');
 await page.getByRole('link', { name: '← На сайт' }).click();
 await verify('/', '«Пижама Кота»');
 await page.goBack(); await verify('/menu/', 'Барная карта');
 await page.goForward(); await verify('/', '«Пижама Кота»');
 for (const [path, title, privatePage] of [['/booking','Бронирование',false], ['/booking-rules','Правила',false], ['/privacy','Политика',false], ['/auth','Вход',true], ['/no-such-page','Страница не найдена',true]]) {
  await page.goto(new URL(path, base).href); await verify(path,title,privatePage);
 }
 await page.getByRole('link', { name: '← НА ГЛАВНУЮ' }).click(); await verify('/', '«Пижама Кота»');
 console.log('PASS direct entry, menu→home, Back/Forward, public/private/404 metadata and unique tags');
} finally { await browser.close(); }
