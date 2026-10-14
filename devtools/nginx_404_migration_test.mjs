import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate } from '../ops/prepare-nginx-404.mjs';

const original = readFileSync(new URL('../ops/nginx-before.fixture.conf', import.meta.url), 'utf8');
const candidate = migrate(original);
assert.equal(migrate(candidate), candidate, 'Repeated deployment must preserve the candidate byte for byte');
assert.equal(migrate(migrate(candidate)), candidate);
const old = 'location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; }';
const start = candidate.indexOf('# Known React routes');
const end = candidate.indexOf('location / { try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }') + 'location / { try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }'.length;
const block = candidate.slice(start, end);
const expectedBlock = `# Known React routes retain SPA entry; everything else must exist on disk.
 location ~ ^/(booking|auth|profile|app|admin|booking-rules|privacy)/?$ {
  rewrite ^ /index.html last;
 }
 error_page 404 =404 /404.html;
 location = /404.html { internal; add_header Cache-Control "no-cache"; }
 location / { try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }`;
assert.equal(block, expectedBlock, 'First migration must match the reviewed 404 block exactly');
assert.equal(migrate(original.replace(old, expectedBlock)), original.replace(old, expectedBlock));
assert.equal(candidate.replace(block, old), original, 'Only the known fallback block may change; API, uploads, game and TLS remain exact');
for (const [label, source] of [
  ['missing fallback', original.replace(old, '')],
  ['duplicate original', original.replace(old, `${old}\n ${old}`)],
  ['duplicate migrated', candidate.replace(block, `${block}\n ${block}`)],
  ['mixed original and migrated', candidate.replace(block, `${block}\n ${old}`)],
  ['changed routes', candidate.replace('booking|auth', 'booking|unexpected|auth')],
  ['changed error status', candidate.replace('404 =404', '404 =200')],
  ['missing internal guard', candidate.replace('internal;', '')],
  ['partial migration', candidate.replace('error_page 404 =404 /404.html;', '')],
  ['unexpected error handling', original.replace(old, `error_page 404 /other.html;\n ${old}`)],
  ['duplicate fallback with different spacing', candidate.replace(block, `${block}\n location /{ try_files $uri /index.html; }`)],
  ['competing prefix root', candidate.replace(block, `${block}\n location ^~ / { try_files $uri /index.html; }`)],
  ['competing exact root', candidate.replace(block, `${block}\n location = / { try_files $uri /index.html; }`)],
  ['404 second in status list', candidate.replace(block, `${block}\n error_page 403 404 /other.html;`)],
  ['404 third in status list', candidate.replace(block, `${block}\n error_page 401 403 404 =200 /other.html;`)],
  ['duplicate 404 location', candidate.replace(block, `${block}\n location = /404.html{ internal; }`)],
  ['unexpected root', candidate.replace('root /opt/cats-pajamas-club/dist_current;', 'root /tmp/other;')],
]) assert.throws(() => migrate(source), undefined, label);
for (const directive of ['error_page 403 /404.html;', 'error_page 403 =404 /other.html;', 'error_page 4040 /other.html;', 'location = /404.html-extra { return 200; }']) {
 const unchanged = candidate.replace(block, `${block}\n ${directive}`);
 assert.equal(migrate(unchanged), unchanged, `Unrelated directive must remain exact: ${directive}`);
}
console.log('PASS nginx 404 migration: first and repeated deployments, exact unrelated configuration preservation, malformed/partial/duplicate rejection');
