// Local Chromium regression test; every API request is mocked before navigation.
// Run with Vite already running: node devtools/auth_dialog_test.mjs [local URL]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5173');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only a local server is allowed');
const shots = new URL('../../docs/audit-2026-10-09/fixes/auth-dialog/', import.meta.url);
await mkdir(shots, { recursive: true });
const browser = await chromium.launch();
const failures = [];
let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed++; }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}

async function fresh(viewport) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      const action = route.request().postDataJSON()?.action;
      const fixtures = {
        '/api/auth': action === 'login_options' ? { demoOtpEnabled: true } : { error: 'Local test: authentication is not performed' },
        '/api/team': { members: [] }, '/api/events': { events: [] },
        '/api/bar-menu': { menu: [], stories: {} },
      };
      await route.fulfill({ status: action && action !== 'login_options' ? 400 : 200,
        contentType: 'application/json', body: JSON.stringify(fixtures[url.pathname] || {}) });
    } else if (url.origin === base.origin || url.protocol === 'data:') await route.continue();
    else await route.abort();
  });
  await page.addInitScript(origin => {
    if (location.origin === origin) localStorage.clear();
    window.open = () => null;
  }, base.origin);
  await page.goto(base.href, { waitUntil: 'networkidle' });
  return { page, errors };
}

async function open(page, mobile) {
  if (mobile) await page.locator('.nav__burger').click();
  const trigger = page.locator(mobile ? '.nav__mobile .nav__tg' : '.nav__actions .nav__tg');
  await trigger.focus();
  await trigger.click();
  await page.locator('.auth-card--modal').waitFor();
  await page.locator('.auth-link').filter({ hasText: 'Локальная демонстрация' }).waitFor();
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 700 },
    { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    const mobile = viewport.width <= 900;
    const label = `${viewport.width}x${viewport.height}`;
    const { page, errors } = await fresh(viewport);
    await open(page, mobile);
    await test(`${label}: named modal dialog receives focus`, async () => {
      const dialog = page.getByRole('dialog', { name: 'Войти или зарегистрироваться' });
      assert.equal(await dialog.count(), 1);
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).fontFamily), '"Avenir Next", sans-serif');
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).color), 'rgb(198, 191, 181)');
      assert(await page.locator('.auth-card--modal').evaluate(el => el.contains(document.activeElement)));
    });
    await test(`${label}: background inert and scrolling locked`, async () => {
      assert(await page.locator('#root').evaluate(el => el.inert));
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      await page.locator('.nav__logo').evaluate(el => el.focus());
      assert(await page.locator('.auth-card--modal').evaluate(el => el.contains(document.activeElement)));
    });
    await test(`${label}: reverse and forward Tab wrap`, async () => {
      await page.locator('.auth-modal__close').focus();
      await page.keyboard.press('Shift+Tab');
      assert(await page.locator('.auth-link').filter({ hasText: 'Локальная демонстрация' }).evaluate(el => el === document.activeElement));
      await page.keyboard.press('Tab');
      assert(await page.locator('.auth-modal__close').evaluate(el => el === document.activeElement));
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        assert(await page.locator('.auth-card--modal').evaluate(el => el.contains(document.activeElement)));
      }
    });
    await page.screenshot({ path: fileURLToPath(new URL(`auth-${label}.png`, shots)) });
    await test(`${label}: changed phone form stays trapped`, async () => {
      await page.locator('.auth-link').filter({ hasText: 'Локальная демонстрация' }).click();
      assert(await page.locator('input[type=tel]').evaluate(el => el === document.activeElement));
      await page.locator('input[type=tel]').fill('+7 900 000 00 00');
      await page.locator('.auth-link').filter({ hasText: '← Войти через Telegram' }).focus();
      await page.keyboard.press('Tab');
      assert(await page.locator('.auth-modal__close').evaluate(el => el === document.activeElement));
      await page.keyboard.press('Shift+Tab');
      assert(await page.locator('.auth-link').filter({ hasText: '← Войти через Telegram' }).evaluate(el => el === document.activeElement));
      await page.keyboard.press('Enter');
      await page.locator('.auth-btn--tg').waitFor();
      assert(await page.locator('.auth-card--modal').evaluate(el => el.contains(document.activeElement)));
    });
    await test(`${label}: Escape restores focus and background`, async () => {
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.auth-card--modal').count(), 0);
      assert.equal(await page.locator('#root').evaluate(el => el.inert), false);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert(await page.locator(mobile ? '.nav__burger' : '.nav__actions .nav__tg').evaluate(el => el === document.activeElement),
        await page.evaluate(() => document.activeElement.outerHTML.slice(0, 300)));
    });
    await test(`${label}: close button and backdrop restore focus`, async () => {
      for (const method of ['close', 'backdrop']) {
        await open(page, mobile);
        if (method === 'close') await page.locator('.auth-modal__close').click();
        else await page.locator('.auth-modal-overlay').click({ position: { x: 2, y: 2 } });
        assert.equal(await page.locator('.auth-card--modal').count(), 0);
        assert(await page.locator(mobile ? '.nav__burger' : '.nav__actions .nav__tg').evaluate(el => el === document.activeElement));
      }
    });
    await test(`${label}: no page errors or horizontal overflow`, async () => {
      assert.deepEqual(errors, []);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await page.close();
  }

  // Exercise callback rerenders and parent unmount without changing the app.
  const { page } = await fresh({ width: 1366, height: 700 });
  await page.locator('.cookie-banner__decline').click();
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: AuthModal } = await import('/src/auth/AuthModal.jsx');
    const host = document.createElement('div'); document.body.append(host);
    const root = ReactDOM.createRoot(host);
    function Harness() {
      const [show, setShow] = React.useState(false);
      const [tick, setTick] = React.useState(0);
      window.dialogHarness = { rerender: () => setTick(t => t + 1), close: () => setShow(false), unmount: () => root.unmount() };
      return React.createElement(React.Fragment, null,
        React.createElement('button', { id: 'harness-open', onClick: () => setShow(true) }, 'Open local dialog'),
        show && React.createElement(AuthModal, { onClose: () => setShow(false), subtitle: `Local fixture ${tick}` }));
    }
    root.render(React.createElement(React.StrictMode, null, React.createElement(Harness)));
  });
  await page.locator('#harness-open').waitFor();
  await page.evaluate(() => {
    document.body.style.overflow = 'clip';
    const original = document.createElement('div'); original.id = 'preexisting-inert'; original.inert = true; document.body.append(original);
  });
  await page.locator('#harness-open').focus();
  await page.locator('#harness-open').click();
  await page.locator('.auth-card--modal').waitFor();
  await test('callback rerender keeps scroll lock and dialog focus', async () => {
    await page.locator('.auth-modal__close').focus();
    await page.evaluate(() => window.dialogHarness.rerender());
    await page.getByText('Local fixture 1').waitFor();
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    assert(await page.locator('.auth-modal__close').evaluate(el => el === document.activeElement));
  });
  await test('new background siblings become inert', async () => {
    await page.evaluate(() => {
      const extra = document.createElement('button'); extra.id = 'new-background'; extra.textContent = 'Background'; document.body.append(extra);
    });
    await page.waitForFunction(() => document.querySelector('#new-background').inert);
    await page.locator('#new-background').evaluate(el => el.focus());
    assert(await page.locator('.auth-card--modal').evaluate(el => el.contains(document.activeElement)));
  });
  await test('parent removes dialog and restores actual initiator and original styles', async () => {
    await page.evaluate(() => window.dialogHarness.close());
    await page.locator('.auth-card--modal').waitFor({ state: 'detached' });
    assert(await page.locator('#harness-open').evaluate(el => el === document.activeElement));
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'clip');
    assert.equal(await page.locator('#new-background').evaluate(el => el.inert), false);
    assert(await page.locator('#preexisting-inert').evaluate(el => el.inert));
  });
  await page.locator('#harness-open').press('Enter');
  await page.locator('.auth-card--modal').waitFor();
  await test('unmount restores previous overflow and preserves existing inert', async () => {
    await page.evaluate(() => window.dialogHarness.unmount());
    assert.equal(await page.locator('.auth-card--modal').count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'clip');
    assert(await page.locator('#preexisting-inert').evaluate(el => el.inert));
    assert.equal(await page.locator('#root').evaluate(el => el.inert), false);
    assert.equal(await page.evaluate(() => document.activeElement.closest('[inert]')), null);
  });
  await page.close();
} finally { await browser.close(); }
console.log(`${passed} passed; ${failures.length} failed. Screenshots: ${shots.pathname}`);
process.exitCode = failures.length ? 1 : 0;
