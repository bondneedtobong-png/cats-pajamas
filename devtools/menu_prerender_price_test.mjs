import assert from 'node:assert/strict';
import { pageHtml, buildSchema, schemaJson } from '../scripts/prerender-menu.mjs';
import { BAR_MENU } from '../src/menu/barMenuData.js';

const invalid = [undefined, null, '', ' ', 'уточняйте', '0 ₽', '-50 ₽', 'от 500 ₽', '40 мл — 500 ₽', '500 ₽ / неизвестно'];
const valid = [['580 ₽', '580'], ['1 350 ₽', '1350'], ['610 / 3 050 ₽', '610'], ['610 ₽ / 3 050 ₽', '610'], [420, '420'], ['12.50 ₽', '12.50']];
const menu = [{ id: 'test', title: 'Test', categories: [{ title: 'Prices', items: [...invalid, ...valid.map(([p]) => p)].map((price, n) => ({ name: `item${n}`, price })) }] }];
const html = pageHtml(menu);
assert(!html.includes('>undefined<') && !html.includes('>null<'), 'Absent prices must render as empty text');
const items = buildSchema(menu).hasMenuSection[0].hasMenuItem;
invalid.forEach((price, n) => assert(!('offers' in items[n]), `Unreliable price ${JSON.stringify(price)} must have no offer`));
valid.forEach(([price, expected], n) => assert.equal(items[invalid.length + n].offers.price, expected, `Valid price ${price}`));
assert(!pageHtml(BAR_MENU).includes('>undefined<'), 'The actual static menu has items without individual prices');
menu[0].categories[0].items[0].name = '</script><script>alert(1)</script>';
const embedded = schemaJson(menu);
assert(!embedded.includes('<'), 'Owner text must not terminate the JSON-LD script');
assert.deepEqual(JSON.parse(embedded), buildSchema(menu), 'Safe embedding must preserve owner text');
console.log('Menu prerender price scenarios PASS');
