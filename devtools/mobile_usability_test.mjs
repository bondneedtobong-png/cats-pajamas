import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { TABLES, activeSeats } from '../src/booking/tablesConfig.js';
const base = new URL(process.argv[2] || 'http://127.0.0.1:5173');
assert(['localhost','127.0.0.1'].includes(base.hostname));
const out = new URL('../../docs/audit-2026-10-13/screenshots/', import.meta.url);
await mkdir(out,{recursive:true});
const browser = await chromium.launch();
const tables = TABLES.map(t => ({...t,activeSeatsCount:activeSeats(t),status:'vacant'}));
const errors=[];
try {
for (const [width,height] of [[320,740],[390,844],[768,1024],[1366,700]]) {
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cpjc_cookie_consent','declined'));
 await page.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.pathname.startsWith('/api/')) {
   const action=r.postDataJSON()?.action;
   let body={};
   if(url.pathname==='/api/auth') {
    assert(['login_options','request_otp'].includes(action),'no real login operation');
    body=action==='login_options'?{demoOtpEnabled:true}:{devCode:'1234'};
   } else { assert.equal(r.method(),'GET');
    if(url.pathname==='/api/tables')body=url.searchParams.has('dates')?{dates:{blockedDates:[]}}:{tables};
    if(url.pathname==='/api/events')body={events:[]};
    if(url.pathname==='/api/team')body={members:[]};
    if(url.pathname==='/api/bar-menu')body={menu:[],stories:{}};
   }
   return route.fulfill({json:body});
  }
  if(url.origin!==base.origin)return route.abort();
  return route.continue();
 });
 await page.goto(new URL('/booking',base).href);
 await page.locator('.fp-table').nth(8).waitFor();
 if(width<=900){
  await page.locator('.fp-table').first().click();
  await page.waitForTimeout(100);
  const rect=await page.locator('.bkw__selection').boundingBox();
  assert(rect.y>=0 && rect.y+rect.height<=height,'SVG tap confirmation in viewport');
  assert.equal(await page.locator('.bkw__table-option').count(),9);
  const option=page.locator('.bkw__table-option').last();
  assert((await option.boundingBox()).height>=44);
  await option.click();
  assert.equal(await option.getAttribute('aria-pressed'),'true');
  const confirmation=page.locator('.bkw__selection');
  assert(await confirmation.isVisible());
  await page.screenshot({path:new URL(`booking-readable-${width}.png`,out).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await confirmation.locator('button').click();
  assert.equal(await page.locator('.bkw__side').evaluate(el=>el===document.activeElement),true);
 } else await page.screenshot({path:new URL(`booking-readable-${width}.png`,out).pathname.replace(/^\/(\w:)/,'$1')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto(new URL('/auth?next=/profile',base).href);
 for(const selector of ['.auth-sub','.auth-hint','.auth-link']) {
  const ratio=await page.locator(selector).first().evaluate(el=>{
   const channels=css=>css.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});
   const luminance=css=>{const [r,g,b]=channels(css);return .2126*r+.7152*g+.0722*b;};
   const fg=luminance(getComputedStyle(el).color),bg=luminance(getComputedStyle(el.closest('.auth-card')).backgroundColor);
   return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  });
  assert(ratio>=4.5,`${selector} contrast ${ratio}`);
 }
 await page.locator('.auth-link').filter({hasText:'Локальная демонстрация'}).click();
 const phone=page.getByLabel('НОМЕР ТЕЛЕФОНА');
 await phone.fill('+79001234567');
 await page.locator('label.auth-label').click();
 assert.equal(await phone.evaluate(el=>el===document.activeElement),true);
 await page.locator('button.auth-btn').click();
 const otp=page.getByLabel('ДЕМО-КОД');await otp.waitFor();
 assert(await otp.getAttribute('aria-describedby'));
 await page.screenshot({path:new URL(`auth-readable-${width}.png`,out).pathname.replace(/^\/(\w:)/,'$1')});
 await page.locator('.auth-back-link a').click();assert.equal(new URL(page.url()).pathname,'/booking');
 await page.goto(base.href);await page.locator('.hero__content').waitFor();
 assert.equal(await page.locator('.hero__content').evaluate(el=>getComputedStyle(el).animationName),'none');
 assert.equal(await page.locator('.hero__content').evaluate(el=>getComputedStyle(el).opacity),'1');
 assert.equal(await page.locator('.hero__curtain-wrap').isVisible(),false);
 if(width<=900){const burger=page.locator('.nav__burger');await burger.click();assert.equal(await burger.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await burger.getAttribute('aria-expanded'),'false');assert.equal(await burger.evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('.nav__mobile').evaluate(el=>el.inert),true);}
 await page.close();console.log(`PASS mobile usability ${width}x${height}`);
}
assert.deepEqual(errors,[]);
}finally{await browser.close();}
