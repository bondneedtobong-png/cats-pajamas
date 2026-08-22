// E2E-проверки лендинга в настоящем Chromium (Playwright, headless).
// Написано под баг прода 2026-08-22: «reveal зависает на opacity:0 при быстрой
// прокрутке» + «шапка рябит при наведении». Оба сценария сначала были
// воспроизведены в живом Chrome владельца, здесь они закреплены тестом.
//
// Запуск (dev-сервер должен работать): node devtools/reveal_e2e.mjs
// Другой адрес:                        node devtools/reveal_e2e.mjs http://localhost:4173
// Ждём ALL SCENARIOS PASS.
//
// Почему Playwright, а не превью-панель или обычный Chrome: у окна, перекрытого
// другим окном, Chrome под Windows помечает вкладку hidden — а в скрытой вкладке
// браузер не считает пересечения и не выдаёт кадры rAF вообще (проверено: ноль
// колбэков IntersectionObserver и ноль кадров в секунду). Проверять визуальные
// баги в таком окне бессмысленно: «не воспроизводится» там ничего не значит.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5173';
const DESKTOP = { width: 1366, height: 700 }; // низкая высота — по правилу CLAUDE.md
const MOBILE = { width: 390, height: 844 };

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  OK  ' : '  FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed++;
}

// Все .reveal, которые зритель уже должен видеть: хоть частично на экране или
// прокручены выше него. Каждый обязан иметь класс .visible — иначе это дыра,
// ровно тот баг, что ловим.
const STUCK_REVEALS = `(() => {
  const vh = window.innerHeight;
  return [...document.querySelectorAll('.reveal')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      name: (el.className.replace(/reveal|visible|reveal-group/g, '').trim() || el.tagName).slice(0, 24),
      seen: (r.top < vh && r.bottom > 0) || r.bottom <= 0,
      visible: el.classList.contains('visible'),
      opacity: getComputedStyle(el).opacity,
    };
  }).filter((x) => x.seen && !x.visible);
})()`;

// Ждём класс .visible И конца перехода (opacity доезжает до 1), опрашивая
// страницу. Возвращает, за сколько миллисекунд блок стал полностью видимым,
// или null, если так и не стал.
async function waitRevealed(page, selector, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const done = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el.classList.contains('visible') && getComputedStyle(el).opacity === '1';
    }, selector);
    if (done) return Date.now() - started;
    await page.waitForTimeout(100);
  }
  return null;
}

async function fresh(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  return page;
}

// Прыжок скроллбаром так, чтобы от высокого блока была видна узкая полоса.
// Старый порог (threshold 0.07 от площади САМОГО блока) здесь не берётся:
// 40px от блока в 1072px — это 0.037, и текст висел прозрачным прямо на экране.
//
// Ждём с запасом и опросом, а не фиксированной паузой: в headless-Chromium
// программный window.scrollTo (в отличие от живого колеса) не порождает
// события scroll, и пересечение приезжает с задержкой до полутора секунд —
// артефакт стенда, в браузере владельца страховка срабатывает за SETTLE_MS.
async function scenarioTallBlock(browser, viewport, label) {
  const page = await fresh(browser, viewport);
  const height = await page.evaluate(() => {
    const el = document.querySelector('.about__text');
    const abs = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, abs - window.innerHeight + 40);
    return Math.round(el.getBoundingClientRect().height);
  });
  const shownAfter = await waitRevealed(page, '.about__text', 5000);
  const res = await page.evaluate(() => {
    const el = document.querySelector('.about__text');
    const r = el.getBoundingClientRect();
    const visPx = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    return {
      visPx: Math.round(visPx),
      ratio: +(visPx / r.height).toFixed(3),
      visible: el.classList.contains('visible'),
      opacity: getComputedStyle(el).opacity,
    };
  });
  check(
    `[${label}] высокий блок (${height}px), видна полоса ${res.visPx}px = ${res.ratio} его площади`,
    res.visible && res.opacity === '1',
    res.visible ? `показан за ${shownAfter}мс` : `visible=${res.visible} opacity=${res.opacity}`,
  );
  await page.close();
}

// Вихревая прокрутка колесом: страницу двигает компоузер, кадры главного потока
// пропускаются, и элемент успевает проскочить экран между двумя расчётами
// пересечений — колбэк не приходит вообще.
async function scenarioFastWheel(browser, viewport, label) {
  const page = await fresh(browser, viewport);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(1500);
  const stuck = await page.evaluate(STUCK_REVEALS);
  check(
    `[${label}] быстрая прокрутка колесом (12 × 1400px)`,
    stuck.length === 0,
    stuck.length ? JSON.stringify(stuck) : 'ни один блок не остался прозрачным',
  );
  await page.close();
}

// Рывки скроллбаром через всю страницу — злейший случай: между позициями вообще
// нет промежуточных кадров.
async function scenarioScrollbarJumps(browser, viewport, label) {
  const page = await fresh(browser, viewport);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (const frac of [0.25, 0.5, 0.75, 1, 0.4]) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(total * frac));
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  const stuck = await page.evaluate(STUCK_REVEALS);
  check(
    `[${label}] рывки скроллбаром по всей странице`,
    stuck.length === 0,
    stuck.length ? JSON.stringify(stuck) : 'ни один блок не остался прозрачным',
  );
  await page.close();
}

async function scenarioAnchor(browser) {
  const page = await fresh(browser, DESKTOP);
  await page.click('.nav__link[href="#events"]');
  await page.waitForTimeout(1400);
  const res = await page.evaluate(() => {
    const el = document.querySelector('.events__title');
    return { visible: el.classList.contains('visible'), opacity: getComputedStyle(el).opacity };
  });
  check('[desktop] переход по якорю «Афиша» (рабочий путь — не сломан)', res.visible && res.opacity === '1', `opacity=${res.opacity}`);
  await page.close();
}

// Блок, который монтируется ПОЗЖЕ первой отрисовки (витрина афиши ждёт ответ
// API). На таком узле прежний useReveal тихо не срабатывал: на момент эффекта
// ref.current был null, и секция навсегда оставалась прозрачной — поймано
// 2026-08-23 на живой витрине. Если событий нет, проверять нечего.
async function scenarioLateMount(browser) {
  const page = await fresh(browser, DESKTOP);
  await page.evaluate(() => document.querySelector('#events').scrollIntoView());
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const grid = document.querySelector('.evac');
    if (!grid) return { skipped: true };
    const wrap = grid.closest('.reveal');
    return { skipped: false, visible: wrap?.classList.contains('visible'), opacity: wrap && getComputedStyle(wrap).opacity };
  });
  if (state.skipped) {
    console.log('  ..   [desktop] витрина афиши: событий нет — проверка пропущена');
  } else {
    check('[desktop] витрина афиши, смонтированная после ответа API, раскрылась', state.visible && state.opacity === '1', `visible=${state.visible} opacity=${state.opacity}`);
  }
  await page.close();
}

async function scenarioResize(browser) {
  const page = await fresh(browser, DESKTOP);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
  await page.waitForTimeout(600);
  await page.setViewportSize(MOBILE); // смена вьюпорта перекраивает раскладку
  await page.waitForTimeout(1200);
  const stuck = await page.evaluate(STUCK_REVEALS);
  check('[desktop→mobile] смена размера окна не оставляет прозрачных блоков', stuck.length === 0, stuck.length ? JSON.stringify(stuck) : 'ок');
  await page.close();
}

// Шапка: правила визуала CLAUDE.md, проверяемые машиной. Рябь при наведении
// давал не сам эффект, а СПОСОБ: перекраска (background-position, box-shadow)
// внутри fixed-шапки с backdrop-filter — каждый кадр пересобиралась подложка
// под всей шапкой.
async function scenarioNavPaint(browser) {
  const page = await fresh(browser, DESKTOP);
  const nav = await page.evaluate(() => {
    const el = document.querySelector('.nav');
    const link = document.querySelector('.nav__link');
    const tg = document.querySelector('.nav__tg, .nav__profile');
    const cs = getComputedStyle(el);
    return {
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      afterTransition: getComputedStyle(link, '::after').transitionProperty,
      linkTransition: getComputedStyle(link).transitionProperty,
      tgTransition: tg ? getComputedStyle(tg).transitionProperty : '',
    };
  });
  check('[desktop] .nav без backdrop-filter', nav.backdrop === 'none', `backdrop-filter: ${nav.backdrop}`);
  check('[desktop] блик .nav__link::after едет transform, а не background-position', nav.afterTransition === 'transform', `transition-property: ${nav.afterTransition}`);
  check(
    '[desktop] в переходах шапки нет перекрашиваемых свойств',
    ![nav.linkTransition, nav.tgTransition].some((t) => /background-position|box-shadow|filter/.test(t)),
    `link: ${nav.linkTransition} | tg: ${nav.tgTransition}`,
  );

  // Блик должен реально проезжать по кнопке на hover — эффект владельца сохранён.
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('.nav__link'), '::after').transform);
  await page.hover('.nav__link');
  await page.waitForTimeout(400);
  const during = await page.evaluate(() => getComputedStyle(document.querySelector('.nav__link'), '::after').transform);
  check('[desktop] блик при наведении едет (эффект на месте)', before !== during, `${before} → ${during}`);
  await page.close();
}

const browser = await chromium.launch();
console.log(`\nЛендинг: ${URL}\n`);
console.log('Reveal при быстрой прокрутке:');
await scenarioTallBlock(browser, DESKTOP, 'desktop 1366×700');
await scenarioTallBlock(browser, MOBILE, 'mobile 390×844');
await scenarioFastWheel(browser, DESKTOP, 'desktop 1366×700');
await scenarioFastWheel(browser, MOBILE, 'mobile 390×844');
await scenarioScrollbarJumps(browser, DESKTOP, 'desktop 1366×700');
await scenarioScrollbarJumps(browser, MOBILE, 'mobile 390×844');
await scenarioAnchor(browser);
await scenarioLateMount(browser);
await scenarioResize(browser);
console.log('\nШапка (рябь при наведении):');
await scenarioNavPaint(browser);
await browser.close();

console.log(failed ? `\n${failed} FAILED\n` : '\nALL SCENARIOS PASS\n');
process.exit(failed ? 1 : 0);
