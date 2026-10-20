// Real HTTP/helper/CAS + real TransferModal in isolated Chromium.
// Only synthetic loopback PostgREST; no .env, production DB or Telegram.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createDb, startPgrestMock } from './pgrest-mock.mjs';

const db=createDb({users:[{id:'admin',role:'admin'},{id:'guest',role:'guest'}]});
const server=await startPgrestMock(db,0);
process.env.SUPABASE_URL=`http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-transfer-key';
process.env.SESSION_SECRET='synthetic-transfer-session-secret';
delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_STAFF_CHAT_ID;
const originalFetch=globalThis.fetch;
let hook=null,browser;
globalThis.fetch=async(url,options)=>{
  assert(String(url).startsWith(process.env.SUPABASE_URL+'/'),'External network forbidden');
  if(hook)await hook(new URL(String(url)),options);
  return originalFetch(url,options);
};
const {default:handler}=await import('../api/reservations.js');
const {updateReservation}=await import('../api/_lib/booking.js');
const {issueToken}=await import('../api/_lib/session.js');
const fields=row=>({status:row.status,tableId:row.table_id,date:row.date,timeFrom:row.time_from,timeTo:row.time_to,guestsCount:row.guests_count});
function seed(status='confirmed') {
  hook=null;for(const name of ['reservations','table_occupancy','app_config'])db.t(name).length=0;
  const row={id:'r1',table_id:'T1',guest_id:'guest',status,date:'2099-10-12',time_from:'20:00',time_to:'23:00',guests_count:2,guest_name:'Synthetic guest',source:'web',created_at:'2099-10-01T00:00:00Z'};
  db.t('reservations').push(row);return row;
}
async function request(body,user='admin') {
  const response={setHeader(){return this;},status(code){this.code=code;return this;},end(value){this.body=value?JSON.parse(value):null;}};
  await handler({method:'PATCH',query:{},headers:user?{authorization:'Bearer '+issueToken(user)}:{},body},response);
  return response;
}
const body=(expected,updates={tableId:'T2'})=>({id:'r1',action:'update',updates,expected});
try {
  let row=seed(),s0=Object.freeze(fields(row));
  assert.equal((await request(body(s0,{tableId:'T2',timeTo:'23:30'}))).code,200);
  const s1=JSON.stringify(row);
  const stale=await request(body(s0,{tableId:'T3'}));
  assert.equal(stale.code,409);assert.match(stale.body.error,/Бронь изменилась/);assert.equal(JSON.stringify(row),s1);
  for(const [key,value]of Object.entries({status:'seated',table_id:'T3',date:'2099-10-13',time_from:'21:00',time_to:'23:30',guests_count:3})) {
    row=seed();s0=fields(row);row[key]=value;const before=JSON.stringify(row);
    assert.equal((await request(body(s0))).code,409,key);assert.equal(JSON.stringify(row),before,key);
  }
  row=seed();s0=fields(row);
  let winner;
  hook=async(url,options)=>{
    if(options?.method==='PATCH'&&url.pathname.endsWith('/reservations')) {
      hook=null;
      assert.equal((await request(body(fields(row),{timeTo:'23:30'}))).code,200);
      winner=JSON.stringify(row);
      const query=url.searchParams;assert.equal(query.get('time_to'),'eq.23:00');
      assert.equal(query.get('guests_count'),'eq.2');
    }
  };
  assert.equal((await request(body(s0))).code,409);assert.equal(JSON.stringify(row),winner);
  row=seed();assert.equal((await request(body(fields(row)))).code,200);assert.equal(row.table_id,'T2');
  const malformed=[undefined,null,[],{},'snapshot',{...fields(row),guestsCount:'2'},
    {...fields(row),guestsCount:0},{...fields(row),guestsCount:2147483648},{...fields(row),date:'2099-02-29'},
    {...fields(row),timeFrom:'25:00'},{...fields(row),timeTo:null},
    {...fields(row),status:'unknown'},{...fields(row),tableId:''},
    {...fields(row),extra:true}];
  for(const expected of malformed){const before=JSON.stringify(row);assert.equal((await request(body(expected))).code,400);assert.equal(JSON.stringify(row),before);}
  assert.equal((await request({id:'r1',action:'update',updates:{tableId:'T1'}})).code,400);
  assert.equal((await request(body(fields(row)),null)).code,401);
  assert.equal((await request(body(fields(row)),'guest')).code,403);
  row=seed('seated');db.t('table_occupancy').push({id:'o1',table_id:'T1',source:'reservation',reservation_id:'r1',freed_at:null});
  const seated=JSON.stringify([row,db.t('table_occupancy')]);
  assert.equal((await request(body(fields(row)))).code,400);assert.equal(JSON.stringify([row,db.t('table_occupancy')]),seated);
  row=seed();await updateReservation('r1',{tableId:'T2'});assert.equal(row.table_id,'T2','trusted internal calls retain compatibility');

  // Exercise actual frontend service serialization before the modal fixture.
  const serviceSource=(await readFile(new URL('../src/booking/BookingService.js',import.meta.url),'utf8'))
    .replace(/^import[^;]+;\r?\n/gm,'').replace(/export default BookingService;/,'return BookingService;');
  let transport;
  const service=new Function('apiFetch','PaymentProvider',serviceSource)(async(route,options)=>{transport={route,...options};return{reservation:{id:'r1'}};},{});
  await service.updateReservation('r1',{tableId:'T2'},s0);
  assert.deepEqual(transport.body,{id:'r1',action:'update',updates:{tableId:'T2'},expected:s0});

  const ui=await readFile(new URL('../src/admin/AdminPage.jsx',import.meta.url),'utf8');
  const start=ui.indexOf('function TransferModal('),end=ui.indexOf('// ─── Tab: БРОНИ',start);
  assert(start>=0&&end>start);assert.match(ui,/<TransferModal key=\{transferRes.id\}/);
  const component=ui.slice(start,end);
  const fixture=`
import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
window.writes=[];window.saved=0;window.closed=0;window.conflicts=0;window.mode='conflict';
const BookingService={getTablesMerged:async()=>[{id:'T1',seatsCount:6},{id:'T2',seatsCount:6},{id:'T3',seatsCount:6}],
 updateReservation:async(id,updates,expected)=>{window.writes.push(JSON.parse(JSON.stringify({id,updates,expected})));if(window.mode==='pending')await new Promise(resolve=>window.finish=resolve);else if(window.mode==='conflict')throw Object.assign(new Error('Бронь изменилась. Закройте окно переноса и откройте его заново.'),{status:409});}};
const adminArrivalSlots=()=>['20:00','21:00'];const activeSeats=t=>t.seatsCount;const endTimeOptions=()=>['23:00','23:30'];
${component}
const root=createRoot(document.getElementById('root'));
window.show=reservation=>root.render(<React.StrictMode><TransferModal key={reservation.id} reservation={reservation} onSaved={()=>window.saved++} onClose={()=>{window.closed++;root.render(null)}} onConflict={()=>window.conflicts++}/></React.StrictMode>);
`;
  const bundle=await build({stdin:{contents:fixture,loader:'jsx',resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent'});
  browser=await chromium.launch();const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const reservation={id:'r1',status:'confirmed',tableId:'T1',date:'2099-10-12',timeFrom:'20:00',timeTo:'23:00',guestsCount:2,guestName:'Synthetic guest'};
  const expected=Object.fromEntries(['status','tableId','date','timeFrom','timeTo','guestsCount'].map(key=>[key,reservation[key]]));
  await page.evaluate(value=>window.show(value),reservation);
  const modal=page.locator('.adm-modal');await modal.locator('select').nth(0).selectOption('T2');
  await modal.locator('select').nth(2).selectOption('23:30');
  // A list refresh changes props, but never rebases this opening's expectation.
  await page.evaluate(value=>window.show(value),{...reservation,tableId:'T3',timeTo:'23:30'});
  await modal.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByText('Бронь изменилась. Закройте окно переноса и откройте его заново.',{exact:true}).waitFor();
  assert.equal(await modal.locator('select').nth(0).inputValue(),'T2');assert.equal(await modal.locator('select').nth(2).inputValue(),'23:30');
  await page.waitForTimeout(80);
  const state=await page.evaluate(()=>({writes:window.writes,saved:window.saved,conflicts:window.conflicts}));
  assert.equal(state.writes.length,1);assert.deepEqual(state.writes[0].expected,expected);assert.equal(state.saved,0);assert.equal(state.conflicts,1);
  await page.evaluate(()=>window.mode='pending');await modal.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>window.writes.length===2);
  // Close A, reopen the SAME reservation, then resolve A: id equality alone
  // cannot protect the new modal; the closed instance must be inactive.
  await modal.locator('.adm-modal__close').click();await page.locator('.adm-modal').waitFor({state:'detached'});
  await page.evaluate(value=>window.show(value),{...reservation,tableId:'T3'});await page.locator('.adm-modal').waitFor();
  await page.evaluate(()=>window.finish());await page.waitForTimeout(50);
  assert.equal(await page.locator('.adm-modal').count(),1);assert.equal(await page.evaluate(()=>window.saved),0);
  assert.equal(await page.locator('.adm-modal select').nth(0).inputValue(),'T3');
  console.log('PASS transfer snapshot: real API stale-open/read-write races 409 with winner preserved, strict 400/auth/seated guards, internal compatibility, real Chromium frozen opening snapshot/draft/error/no auto-retry/late response isolation.');
} finally {
  if(browser)await browser.close();globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
}
