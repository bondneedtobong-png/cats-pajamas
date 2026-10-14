import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = new URL(process.argv[2] || 'http://127.0.0.1:5173');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname));
const shots = new URL('../../docs/audit-2026-10-09/fixes/admin-booking/', import.meta.url);
await mkdir(shots, { recursive: true });
const browser = await chromium.launch();
const reservation = { id:'fixture', tableId:'six', date:'2026-10-16', timeFrom:'03:00', timeTo:'03:15', guestsCount:6, guestName:'Тестовый гость', status:'confirmed', source:'phone_manual' };
try {
 for (const width of [390,768,1366]) {
  const page = await browser.newPage({ viewport:{ width, height:width===1366?700:900 } });
  const errors=[], writes=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.clock.install({ time:new Date('2026-10-14T14:20:00Z') });
  await page.route('**/*', async route=> {
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/api/')) {
    let data={};
    if(url.pathname==='/api/tables') data={tables:[{id:'two', seatsCount:2, name:'Два места'},{id:'six',seatsCount:6,name:'Шесть мест'}]};
    if(url.pathname==='/api/reservations') {
     if(route.request().method()==='GET') data={reservations:[reservation]};
     else { writes.push(route.request().postDataJSON()); data={reservation}; }
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   } else if(url.origin===base.origin) await route.continue(); else await route.abort();
  });
  await page.addInitScript(()=>{localStorage.setItem('cpjc_token','local-fixture');localStorage.setItem('cpjc_user',JSON.stringify({id:'fixture-admin',role:'admin',name:'Тест'}));});
  await page.goto(new URL('/admin',base).href, {waitUntil:'networkidle'});
  await page.getByRole('button',{name:'+ Добавить (звонок)'}).click();
  const modal=page.locator('.adm-modal');
  const table=modal.locator('select').nth(0), from=modal.locator('select').nth(1), to=modal.locator('select').nth(2), guests=modal.locator('select').nth(3), date=modal.locator('input[type=date]');
  const values=locator=>locator.locator('option').evaluateAll(opts=>opts.map(o=>o.value));
  assert.deepEqual(await values(guests),['','1','2']);
  assert((await values(from)).includes('18:00'),'admin 30-minute grace retains 18:00 at 18:20');
  await table.selectOption('six'); await guests.selectOption('6');
  await table.selectOption('two'); assert.equal(await guests.inputValue(),'');
  await date.fill('2026-10-16');
  assert((await values(from)).includes('16:00')); assert((await values(from)).includes('03:00')); assert(!(await values(from)).includes('03:30'));
  await from.selectOption('03:00'); await date.fill('2026-10-15'); assert.equal(await from.inputValue(),'');
  assert((await values(from)).includes('01:00')); assert(!(await values(from)).includes('01:30'));
  await from.selectOption('19:00'); await date.fill('2026-10-16'); assert.equal(await from.inputValue(),'19:00');
  await guests.selectOption('2'); await modal.locator('input[type=text]').fill('Тестовый гость');
  await page.screenshot({path:new URL(`manual-${width}.png`,shots).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await modal.getByRole('button',{name:'Сохранить бронь'}).click(); await modal.waitFor({state:'detached'});
  assert.equal(writes[0].guestsCount,2); assert.equal(writes[0].timeFrom,'19:00');
  await page.getByRole('button',{name:'Перенести',exact:true}).click();
  const transfer=page.locator('.adm-modal');
  assert(await transfer.locator('select').nth(0).locator('option[value=two]').isDisabled());
  assert.equal(await transfer.locator('select').nth(1).inputValue(),'03:00');
  assert.equal(await transfer.locator('select').nth(2).inputValue(),'03:15');
  await transfer.locator('input[type=date]').fill('2026-10-15');
  assert.equal(await transfer.locator('select').nth(1).inputValue(),'');
  await transfer.locator('select').nth(1).selectOption('01:00');
  await page.screenshot({path:new URL(`transfer-${width}.png`,shots).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await transfer.getByRole('button',{name:'Сохранить',exact:true}).click(); await transfer.waitFor({state:'detached'});
  assert.equal(writes[1].updates.tableId,'six'); assert.equal(writes[1].updates.timeFrom,'01:00'); assert.equal(writes[1].updates.timeTo,'03:15'); assert(!('guestsCount' in writes[1].updates));
  await page.clock.setSystemTime(new Date('2026-10-14T01:20:00Z'));
  await page.getByRole('button',{name:'+ Добавить (звонок)'}).click();
  assert.equal(await page.locator('.adm-modal input[type=date]').inputValue(),'2026-10-13','before 06:00 Samara belongs to previous evening');
  assert.deepEqual(errors,[]); await page.close(); console.log(`PASS admin manual/transfer options ${width}px`);
 }
} finally {await browser.close();}
