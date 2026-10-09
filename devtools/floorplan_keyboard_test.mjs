// Real Chromium against local Vite only. Every API request is fulfilled locally;
// external resources and all unexpected API methods/paths are blocked.
// Run: node devtools/floorplan_keyboard_test.mjs [http://localhost:5173]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TABLES, activeSeats } from '../src/booking/tablesConfig.js';

const base = new URL(process.argv[2] || 'http://localhost:5173');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'only local Vite is allowed');
const out = fileURLToPath(new URL('../../docs/audit-2026-10-09/fixes/floorplan/', import.meta.url));
await mkdir(out, { recursive: true });
const fixtures = TABLES.map((t, i) => ({ ...t, activeSeatsCount: activeSeats(t),
  status: i === 1 ? 'reserved' : i === 2 ? 'occupied' : 'vacant',
  reservation: i === 1 ? { timeFrom: '20:00' } : null,
}));
const requests = [], unexpected = [], errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.addInitScript(() => {
  if (location.protocol === 'http:') localStorage.setItem('cpjc_cookie_consent', 'declined');
});
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    requests.push({ method: request.method(), path: url.pathname + url.search });
    if (request.method() === 'GET' && url.pathname === '/api/tables') {
      const body = url.searchParams.has('dates')
        ? { dates: { blockToday: false, blockTomorrow: false, blockedDates: [] } }
        : { tables: fixtures };
      return route.fulfill({ json: body });
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 403, json: { error: 'Blocked by isolated floorplan test' } });
  }
  if (url.origin !== base.origin) return route.abort('blockedbyclient');
  return route.continue();
});
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));

async function focusedTable(page) {
  return page.evaluate(() => document.activeElement?.classList.contains('fp-table'));
}
async function assertSelection(page, index) {
  const tables = page.locator('.fp-table');
  for (const key of ['Enter', 'Space']) {
    await page.locator('.fp-svg').dispatchEvent('click');
    assert.equal(await tables.nth(index).getAttribute('aria-pressed'), 'false', 'selection reset before each key');
    await tables.nth(index).focus();
    await page.keyboard.press(key);
    assert.equal(await tables.nth(index).getAttribute('aria-pressed'), 'true', `${key} selects table ${index}`);
    assert.equal(await page.locator('.fp-table[aria-pressed="true"]').count(), 1, 'one selected table');
  }
}

try {
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1366, 700]]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(new URL('/booking', base).href);
    await page.locator('.fp-table').nth(8).waitFor();
    const tables = page.locator('.fp-table');
    assert.equal(await tables.count(), 9);
    const names = [];
    for (let i = 0; i < 9; i++) {
      assert.equal(await tables.nth(i).getAttribute('role'), 'button', `table ${i} has button semantics`);
      assert.equal(await tables.nth(i).getAttribute('tabindex'), '0', `table ${i} participates in Tab order`);
      const name = await tables.nth(i).getAttribute('aria-label');
      assert.match(name, /№\d/);
      assert.match(name, /\d+ мест/);
      names.push(name);
    }
    assert.equal(new Set(names).size, 9, 'zone distinguishes repeated table numbers');
    assert.match(names[1], /Бронь к 20:00/);
    assert.match(names[2], /Занят/);
    await page.evaluate(() => document.activeElement?.blur());
    let tabs = 0;
    while (!(await focusedTable(page)) && tabs++ < 60) await page.keyboard.press('Tab');
    assert.ok(await focusedTable(page), 'real Tab reaches the SVG tables');
    const first = tables.first();
    await first.focus();
    const before = await first.boundingBox();
    const focus = await first.evaluate(el => ({ visible: el.matches(':focus-visible'),
      width: getComputedStyle(el.querySelector('.fp-t-shape')).strokeWidth,
    }));
    assert.ok(focus.visible, 'keyboard focus uses visible focus styling');
    assert.equal(focus.width, '2px', 'focus stroke keeps screen-pixel thickness on mobile');
    await page.screenshot({ path: `${out}/focus-${width}.png`, fullPage: true });
    assert.deepEqual(await first.boundingBox(), before, 'focus does not move table geometry');
    await page.keyboard.press('ArrowRight');
    assert.equal(await first.getAttribute('aria-pressed'), 'false', 'unrelated keys do not select');
    const scroller = page.locator('.bk-body--v2');
    const scrollBefore = await scroller.evaluate(el => el.scrollTop);
    await page.keyboard.press('Space');
    assert.equal(await first.getAttribute('aria-pressed'), 'true');
    assert.equal(await scroller.evaluate(el => el.scrollTop), scrollBefore, 'Space does not scroll the page');
    for (let i = 0; i < 9; i++) await assertSelection(page, i);
    await page.keyboard.press('Shift+Tab');
    assert.ok(await focusedTable(page), 'reverse Tab reaches preceding table');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await page.screenshot({ path: `${out}/selected-${width}.png`, fullPage: true });
    await page.close();
    console.log(`PASS booking keyboard, status names and focus at ${width}×${height}`);
  }

  // Mount the real component with admin-shaped and noninteractive props;
  // no admin route, credentials or login are involved.
  const page = await context.newPage();
  await page.goto(new URL('/booking', base).href);
  await page.locator('.fp-table').nth(8).waitFor();
  await page.evaluate(async fixtures => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default || ReactModule;
    const ReactDOMModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = ReactDOMModule.default || ReactDOMModule;
    const { default: FloorPlanSvg } = await import('/src/booking/FloorPlanSvg.jsx');
    const { translations } = await import('/src/data.js');
    const host = document.createElement('div'); host.className = 'bkw'; document.body.append(host);
    Object.assign(host.style, { position: 'fixed', inset: '0', width: '900px', height: '680px', zIndex: '9999' });
    window.floorplanCalls = [];
    const root = createRoot(host);
    window.renderFloorplan = (interactive, language = 'ru') => root.render(React.createElement(FloorPlanSvg, {
      tables: fixtures, onSelect: interactive ? id => window.floorplanCalls.push(id) : undefined,
      tx: { tableWord: translations[language].bkTableWord, sofaWord: translations[language].bkSofa,
        seatsWord: translations[language].bkSeatsLabel, statusReserved: translations[language].bkStatusReservedAt,
        zoneMain: translations[language].bkZoneMain, zoneWindow: translations[language].bkZoneWindow,
        zoneSofas: translations[language].bkZoneSofas, statusVacant: translations[language].bkStatusVacant,
        statusOccupied: translations[language].bkStatusOccupied },
    }));
    window.renderFloorplan(true);
    host.id = 'floorplan-test-harness';
  }, fixtures.map((t, i) => ({ ...t, selectable: i !== 3 })));
  const harness = page.locator('#floorplan-test-harness');
  await harness.locator('.fp-table').nth(8).waitFor();
  const disabled = harness.locator('.fp-table').nth(3);
  assert.equal(await disabled.getAttribute('aria-disabled'), 'true');
  assert.equal(await disabled.getAttribute('tabindex'), '-1');
  await disabled.focus();
  await page.keyboard.press('Enter'); await page.keyboard.press('Space');
  // Playwright correctly treats aria-disabled as disabled; use real mouse input
  // to ensure our custom SVG handler also refuses pointer activation.
  const disabledBox = await disabled.locator('.fp-t-shape').boundingBox();
  await page.mouse.click(disabledBox.x + disabledBox.width / 2, disabledBox.y + disabledBox.height / 2);
  assert.deepEqual(await page.evaluate(() => window.floorplanCalls), [], 'disabled table never calls selection');
  await harness.locator('.fp-table').nth(2).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.floorplanCalls), ['T2'], 'admin can inspect occupied table');
  await page.keyboard.press('Tab');
  assert.equal(await harness.locator('.fp-table').nth(4).evaluate(el => el === document.activeElement), true,
    'Tab skips explicitly disabled table');
  await page.evaluate(() => window.renderFloorplan(true, 'en'));
  await page.waitForFunction(() => document.querySelector('#floorplan-test-harness .fp-table').getAttribute('aria-label').startsWith('Table'));
  assert.match(await harness.locator('.fp-table').nth(1).getAttribute('aria-label'), /Table №2, Main hall, 4 seats, Booked for 20:00/);
  assert.match(await harness.locator('.fp-table').nth(7).getAttribute('aria-label'), /Sofa №1, Sofas, 6 seats, Free/);
  await page.evaluate(() => window.renderFloorplan(false));
  await page.waitForFunction(() => !document.querySelector('#floorplan-test-harness .fp-table[role="button"]'));
  assert.equal(await harness.locator('.fp-table[tabindex]').count(), 0, 'noninteractive rendering has no tab stops');
  await harness.locator('.fp-table').nth(0).click();
  assert.deepEqual(await page.evaluate(() => window.floorplanCalls), ['T2'], 'noninteractive click is harmless');
  await page.close();
  assert.deepEqual(unexpected, [], 'no unexpected API calls/mutations');
  assert.deepEqual(errors, [], 'browser has no uncaught errors');
  console.log(`PASS disabled, admin and noninteractive props; ${requests.length} fixture GETs; no API mutations`);
} finally {
  await browser.close();
}
