import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyMenuHtml } from '../ops/verify-menu-html.mjs';

const html = readFileSync(new URL('../dist/menu/index.html', import.meta.url), 'utf8');
verifyMenuHtml(html);
for (const literal of ['undefined', 'null']) {
 assert.throws(() => verifyMenuHtml(html.replace(/(<span class="bmn-item__price">)[^<]*/, `$1${literal}`)), /Invalid literal/);
}
for (const price of ['0', '-10', 'null', 'undefined', 'от 500', 'Infinity']) {
 assert.throws(() => verifyMenuHtml(html.replace(/"price":"[^"]+"/, `"price":"${price}"`)), /positive numeric/);
}
assert.throws(() => verifyMenuHtml(html.replaceAll('"priceCurrency":"RUB"', '"priceCurrency":"USD"')), /use RUB/);
assert.throws(() => verifyMenuHtml(html.replace('"@type":"Menu"', '"@type":"Other"')), /one Menu/);
console.log('PASS raw menu verifier: build HTML and malformed prices/currency/schema negative controls');
