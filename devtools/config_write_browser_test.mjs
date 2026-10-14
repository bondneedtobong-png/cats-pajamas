// Actual React components and HTTP client; disposable Vite, no private env/network.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
const shots = fileURLToPath(new URL('../../docs/audit-2026-10-14/settings/', import.meta.url));
const envDir = await mkdtemp(join(tmpdir(), 'cats-settings-browser-'));
const source = await readFile(join(root, 'src/admin/AdminPage.jsx'), 'utf8');
const panels = source.slice(source.indexOf('function TableEditorPanel('), source.indexOf('function TabTables('));
const menu = {menu:[{id:'fixture',title:'Напитки',categories:[{title:'Шотландия',items:[{name:'Исходный напиток',price:'100'}]}]}],stories:{},configRevision:7};
const fixture = `import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import MenuInlineEditor from '/src/menu/MenuInlineEditor.jsx';
import BarMenuService from '/src/menu/BarMenuService.js';
import BookingService from '/src/booking/BookingService.js';
import {FeedbackProvider,useFeedback} from '/src/ui/FeedbackProvider.jsx';
import {upcomingEveningDates} from '/src/booking/barTime.js';
import '/src/index.css'; import '/src/admin/admin.css'; import '/src/menu/barmenu-editor.css'; import '/src/menu/menubook.css'; import '/src/menu/barmenu.css';
${panels}
function App(){const [initial,setInitial]=useState(${JSON.stringify(menu)}); const [open,setOpen]=useState(true); const [saved,setSaved]=useState(null);const [tableSaved,setTableSaved]=useState(0);
return <FeedbackProvider><main><nav><button onClick={()=>BarMenuService.getPublic().then(setInitial)}>Late GET</button><button onClick={()=>setOpen(true)}>Open editor</button><output data-testid="revision">{saved?.configRevision}</output></nav>
<section data-testid="menu">{open&&<MenuInlineEditor initial={initial} onCancel={()=>setOpen(false)} onSaved={s=>{setSaved(s);setInitial(s);setOpen(false)}}/>}</section>
<section data-testid="table"><TableEditorPanel table={{id:'T1',type:'table',zone:'Зал',num:1,depositPrice:200,activeSeatsCount:4}} onSaved={()=>setTableSaved(n=>n+1)}/><output data-testid="table-saved">{tableSaved}</output></section>
<section data-testid="dates"><BookingDatesSection/></section></main></FeedbackProvider>};createRoot(document.getElementById('root')).render(<App/>);`;
let server, browser;
try {
 await mkdir(shots,{recursive:true});
 server=await createServer({root,configFile:false,envDir,plugins:[{name:'settings-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/settings-fixture'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/settings-fixture','<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root" class="app" data-theme="A"></div><script type="module" src="/@vite/client"></script><script type="module" src="/src/__settings_browser_fixture.jsx"></script>'));}else next();});},resolveId(id){if(id==='/src/__settings_browser_fixture.jsx')return '\0settings-fixture.jsx';},async load(id){if(id==='\0settings-fixture.jsx')return (await transformWithEsbuild(fixture,'settings-fixture.jsx',{loader:'jsx',jsx:'transform'})).code;}},react()],server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_API_BASE':JSON.stringify('')}});
 await server.listen(); const base=new URL(server.resolvedUrls.local[0]);
 browser=await chromium.launch();
 for(const width of [390,768,1366]){
  const page=await browser.newPage({viewport:{width,height:width===1366?700:width===768?1024:844},reducedMotion:'reduce'});
  const errors=[],writes=[];let fail=true; page.setDefaultTimeout(10000); page.on('pageerror',e=>{errors.push(e.message);console.error('Fixture page error:',e.message)});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==base.origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   let data,status=200;const req=route.request();
   if(req.method()==='POST'){const body=req.postDataJSON();writes.push(body);if(fail){status=409;data={error:'Настройки уже изменены. Обновите страницу перед сохранением.'};}else if(url.pathname==='/api/bar-menu')data={...body.data,configRevision:8};else data={dates:{blockToday:false,blockTomorrow:false,blockedDates:['2026-12-15']},tables:[]};}
   else if(url.pathname==='/api/bar-menu')data={...menu,menu:[{...menu.menu[0],title:'Late changed title'}],configRevision:99};
   else if(url.pathname==='/api/tables')data={dates:{blockToday:false,blockTomorrow:false,blockedDates:[]},tables:[]};
   else throw new Error('Unexpected API '+url.pathname);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(new URL('/settings-fixture',base).href);
  await page.locator('[data-testid=menu] .mbk-edit-save').waitFor();
  const editable=page.locator('[data-testid=menu] [contenteditable=true]:visible').first();await editable.fill('Несохранённый черновик');await editable.blur();
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/bar-menu')&&r.request().method()==='GET'),page.getByRole('button',{name:'Late GET',exact:true}).click()]);
  assert.equal(await editable.textContent(),'Несохранённый черновик');
  await page.locator('.mbk-edit-save').click();await page.getByText('Настройки уже изменены. Обновите страницу перед сохранением.',{exact:true}).first().waitFor();
  assert.equal(writes.at(-1).configRevision,7);assert.equal(await editable.textContent(),'Несохранённый черновик');assert.equal(await page.locator('.fb-toast--success').count(),0);assert.equal(await page.locator('.mbk-edit-save').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`menu overflow ${width}`);
  await page.screenshot({path:join(shots,`menu-conflict-${width}.png`),fullPage:true});
  fail=false;await page.locator('.mbk-edit-save').click();await page.locator('.mbk-edit-save').waitFor({state:'detached'});assert.equal(await page.locator('[data-testid=revision]').innerText(),'8');
  await page.getByRole('button',{name:'Open editor',exact:true}).click();fail=true;await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/bar-menu')),page.locator('.mbk-edit-save').click()]);assert.equal(writes.at(-1).configRevision,8);if(await page.locator('.fb-toast--success').count())await page.locator('.fb-toast--success').click();
  const table=page.locator('[data-testid=table]');await table.locator('input').nth(0).fill('500');await table.locator('input').nth(1).fill('12');await table.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('.fb-toast--error').first().waitFor();
  assert.equal(await table.locator('input').nth(0).inputValue(),'500');assert.equal(await table.locator('input').nth(1).inputValue(),'12');assert.equal(await page.locator('[data-testid=table-saved]').innerText(),'0');assert.deepEqual(writes.at(-1).expected,{depositPrice:200,seatsCount:4});assert.equal(await page.locator('.fb-toast--success').count(),0);
  const dates=page.locator('[data-testid=dates]');await dates.locator('input[type=date]').fill('2026-12-15');await Promise.all([page.waitForResponse(r=>r.url().includes('/api/tables')&&r.request().method()==='POST'),dates.getByRole('button',{name:'Закрыть выбранную дату',exact:true}).click()]);assert.equal(await dates.locator('input[type=date]').inputValue(),'2026-12-15');assert.deepEqual(writes.at(-1).expected,{dateBlocked:false});assert.equal(await page.locator('.fb-toast--success').count(),0);await page.locator('.fb-toast--error').last().scrollIntoViewIfNeeded();assert.equal(await page.locator('.fb-toast--error').last().isVisible(),true);
  await dates.locator('input').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`settings overflow ${width}`);
  await page.screenshot({path:join(shots,`table-dates-conflict-${width}.png`),fullPage:true});
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS actual browser settings ${width}: menu 409/draft/late GET/revision/success; atomic table/date conflict drafts; no overflow`);
 }
} finally {
 await browser?.close();await server?.close();
 assert.equal(dirname(resolve(envDir)),resolve(tmpdir()),'Browser fixture cleanup escaped the temporary directory');
 assert(basename(envDir).startsWith('cats-settings-browser-'));
 await rm(envDir,{recursive:true,force:true});
}
