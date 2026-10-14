import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function verifyMenuHtml(html) {
 assert(html.includes('Барная карта'), 'Missing raw menu content');
 const prices = [...html.matchAll(/<span\b[^>]*class="bmn-item__price"[^>]*>([\s\S]*?)<\/span>/g)];
 assert(prices.length > 0, 'Missing raw menu price fields');
 for (const [, price] of prices) assert(!/\b(?:undefined|null)\b/i.test(price), 'Invalid literal in raw menu price');
 const schemas = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(([, json]) => JSON.parse(json));
 const menus = schemas.flatMap(schema => schema['@graph'] || [schema]).filter(schema => schema['@type'] === 'Menu');
 assert.equal(menus.length, 1, 'Expected one Menu JSON-LD');
 let offers = 0;
 function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.offers) {
   for (const offer of Array.isArray(value.offers) ? value.offers : [value.offers]) {
    assert(offer && offer.priceCurrency === 'RUB', 'Menu offer must use RUB');
    assert(/^[0-9]+(?:\.[0-9]+)?$/.test(String(offer.price)) && Number.isFinite(Number(offer.price)) && Number(offer.price) > 0,
     'Menu offer price must be a positive numeric value');
    offers++;
   }
  }
  for (const child of Object.values(value)) visit(child);
 }
 visit(menus[0]);
 assert(offers > 0, 'Missing priced Menu offers');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 verifyMenuHtml(readFileSync(process.argv[2], 'utf8'));
 console.log('PASS raw menu: price fields and positive numeric RUB offers');
}
