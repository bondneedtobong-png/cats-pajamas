// Produce a reviewable candidate; never edit the active server configuration.
// Usage: node ops/prepare-nginx-404.mjs before.conf candidate.conf
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
export function migrate(source) {
 const old = 'location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; }';
 assert(source.includes('root /opt/cats-pajamas-club/dist_current;'), 'Unexpected document root');
 const replacement = `# Known React routes retain SPA entry; everything else must exist on disk.
 location ~ ^/(booking|auth|profile|app|admin|booking-rules|privacy)/?$ {
  rewrite ^ /index.html last;
 }
 error_page 404 =404 /404.html;
 location = /404.html { internal; add_header Cache-Control "no-cache"; }
 location / { try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }`;
 const oldCount = source.split(old).length - 1;
 const migratedCount = source.split(replacement).length - 1;
 assert((oldCount === 1 && migratedCount === 0) || (oldCount === 0 && migratedCount === 1),
  'Expected exactly one known original or migrated SPA fallback; inspect changed config manually');
 const remainder = source.replace(oldCount ? old : replacement, '');
 // The exact block is the only accepted migration state. Reject partial or
 // competing handling outside it instead of silently repairing an unknown state.
 const competing404 = [...remainder.matchAll(/\berror_page\s+((?:[0-9]+\s+)+)/g)]
  .some(([, statuses]) => statuses.trim().split(/\s+/).includes('404'));
 assert(!competing404 && !/\blocation\s+(?:(?:\^~|=)\s*)?\/\s*\{|\blocation\s*=\s*\/404\.html\s*\{|\blocation\s+~[^\n{]*\(booking\|/.test(remainder),
  'Unexpected or duplicate SPA/404 handling requires manual review');
 if (migratedCount) return source;
 return source.replace(old, replacement);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/prepare-nginx-404.mjs')) {
 const [input, output] = process.argv.slice(2);
 assert(input && output && input !== output, 'Provide separate input and candidate output paths');
 writeFileSync(output, migrate(readFileSync(input, 'utf8')));
 console.log(`Prepared ${output}; run isolated nginx integration and nginx -t before replacing live config`);
}
