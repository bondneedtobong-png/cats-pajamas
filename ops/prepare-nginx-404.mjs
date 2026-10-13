// Produce a reviewable candidate; never edit the active server configuration.
// Usage: node ops/prepare-nginx-404.mjs before.conf candidate.conf
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
export function migrate(source) {
 const old = 'location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; }';
 assert.equal(source.split(old).length, 2, 'Expected exactly one known SPA fallback; inspect changed config manually');
 assert(source.includes('root /opt/cats-pajamas-club/dist_current;'), 'Unexpected document root');
 assert(!source.includes('error_page 404'), 'Existing 404 handling requires manual review');
 const replacement = `# Known React routes retain SPA entry; everything else must exist on disk.
 location ~ ^/(booking|auth|profile|app|admin|booking-rules|privacy)/?$ {
  rewrite ^ /index.html last;
 }
 error_page 404 =404 /404.html;
 location = /404.html { internal; add_header Cache-Control "no-cache"; }
 location / { try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }`;
 return source.replace(old, replacement);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/prepare-nginx-404.mjs')) {
 const [input, output] = process.argv.slice(2);
 assert(input && output && input !== output, 'Provide separate input and candidate output paths');
 writeFileSync(output, migrate(readFileSync(input, 'utf8')));
 console.log(`Prepared ${output}; run isolated nginx integration and nginx -t before replacing live config`);
}
