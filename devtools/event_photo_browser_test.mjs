// Actual admin editor against local Vite. Every API call uses in-memory fixtures.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const base = new URL(process.argv[2] || 'http://127.0.0.1:5173');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const out = new URL('../../docs/audit-2026-10-09/fixes/events/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [390, 768, 1366, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    const errors = [], calls = [];
    let event = { id: 'ev_fixture', title: 'Photo safety fixture', date: '2099-10-10', time: '19:00', description: 'Local preview', imageUrls: ['/uploads/events/ev_fixture/0.webp'], active: true };
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('cpjc_token', 'fixture');
      localStorage.setItem('cpjc_user', JSON.stringify({ id: 'fixture', role: 'admin', name: 'Local' }));
    });
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) {
        let body = {}; try { body = req.postDataJSON() || {}; } catch {}
        let response = { tables: [], reservations: [], events: [event], users: [], settings: {}, blockedDates: [] };
        if (body.action === 'login_options') response = { demoOtpEnabled: false };
        if (body.action === 'me') response = { user: { id: 'fixture', role: 'admin', name: 'Local' } };
        if (url.pathname === '/api/events' && req.method() === 'POST') {
          calls.push(body.action);
          if (body.action === 'update') { event = { ...event, ...body.data }; response = { event }; }
          else if (body.action === 'delete_photo') response = {};
          else throw Error('Unexpected mutation ' + body.action);
        } else if (req.method() === 'POST' && !['me', 'login_options'].includes(body.action)) throw Error('Unexpected mutation ' + url.pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
      }
      if (url.pathname.startsWith('/uploads/events/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#39203e"/><text x="35" y="100" fill="white">LOCAL PHOTO FIXTURE</text></svg>' });
      if (url.origin === base.origin) return route.continue();
      return route.abort();
    });
    await page.goto(new URL('/admin', base).href);
    await page.getByRole('button', { name: 'СОБЫТИЯ', exact: true }).click();
    await page.getByTitle('Редактировать', { exact: true }).click();
    await page.locator('.adm-modal').waitFor();
    await page.screenshot({ path: fileURLToPath(new URL('editor-' + width + '.png', out)), fullPage: true });
    await page.locator('.adm-modal').getByTitle('Удалить', { exact: true }).click();
    assert.deepEqual(calls, []);
    await page.locator('.adm-modal__close').click();
    await page.locator('.adm-modal').waitFor({ state: 'detached' });
    assert.equal(event.imageUrls.length, 1); assert.deepEqual(calls, []);
    await page.getByTitle('Редактировать', { exact: true }).click();
    await page.locator('.adm-modal').getByTitle('Удалить', { exact: true }).click();
    await page.locator('.adm-modal').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('.adm-modal').waitFor({ state: 'detached' });
    assert.deepEqual(calls, ['update', 'delete_photo']); assert.deepEqual(event.imageUrls, []); assert.deepEqual(errors, []);
    console.log('PASS actual editor cancel preserves original; save precedes cleanup at', width);
    await page.close();
  }
} finally { await browser.close(); }
