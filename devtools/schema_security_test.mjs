// Static schema contract only: does not establish applied RLS/grants on any DB.
// Run: node devtools/schema_security_test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
// All public tables currently use server/service_role access. Future public
// exceptions must have an explicit rationale here; personal data is never one.
const publicExceptions = new Map();

function audit(sql) {
  // Consume comments, literals and dollar-quoted function bodies as whole tokens:
  // fake SQL inside them must not count as security statements.
  const tokens = sql.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|\$(\w*)\$[\s\S]*?\$\1\$|'(?:''|[^'])*'|"(?:""|[^"])*"|[a-z_][a-z_0-9]*|[.;]/gi) || [];
  const statements = [];
  let current = [];
  for (const token of tokens) {
    if (/^(--|\/\*|'|\$)/.test(token)) continue;
    if (token === ';') { statements.push(current); current = []; }
    else current.push(token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token.toLowerCase());
  }
  const tables = new Set(), enabled = new Set(), policies = new Set();
  for (const words of statements) {
    if (words[0] === 'create' && words[1] === 'table') {
      const start = words[2] === 'if' ? 5 : 2;
      assert.equal(words[start], 'public', 'created tables must use explicit public schema');
      assert.equal(words[start + 1], '.');
      tables.add(words[start + 2]);
    }
    if (words[0] === 'alter' && words[1] === 'table') {
      const start = words[2] === 'if' ? 4 : 2;
      if (words[start] !== 'public' || words[start + 1] !== '.') continue;
      const table = words[start + 2];
      const action = words.slice(start + 3).join(' ');
      if (action === 'enable row level security') enabled.add(table);
      if (action === 'disable row level security') enabled.delete(table);
    }
    if (words[0] === 'create' && words[1] === 'policy') {
      const on = words.indexOf('on', 3);
      if (words[on + 1] === 'public' && words[on + 2] === '.') policies.add(words[on + 3]);
    }
  }
  assert.ok(tables.size > 0, 'schema table inventory must not be empty');
  const problems = [];
  for (const table of tables) {
    if (publicExceptions.has(table)) {
      assert.ok(publicExceptions.get(table)?.trim(), 'public exceptions require rationale');
      continue;
    }
    if (!enabled.has(table)) problems.push(`${table}: RLS missing or disabled`);
    if (policies.has(table)) problems.push(`${table}: policy violates service_role-only contract`);
  }
  return { tables, problems };
}

// Negative controls prove inventory checks catch new unprotected tables,
// commented/literal decoys, later DISABLE and policies; no single-line oracle.
const fixture = 'create table public.private_sample (id text);';
const locked = `${fixture} alter table public.private_sample enable row level security;`;
assert.equal(audit(locked).problems.length, 0);
assert.ok(audit(`${locked} create table public.new_private (id text);`).problems.includes('new_private: RLS missing or disabled'));
assert.ok(audit(`${fixture} -- alter table public.private_sample enable row level security;`).problems.length);
assert.ok(audit(`${fixture} select 'alter table public.private_sample enable row level security;';`).problems.length);
assert.ok(audit(`${locked} alter table public.private_sample disable row level security;`).problems.length);
assert.ok(audit(`${locked} create policy read_all on public.private_sample for select to anon using (true);`).problems.length);

const result = audit(schema);
assert.ok(result.tables.has('booking_inquiries'), 'private inquiry table must be present');
assert.deepEqual(result.problems, [], 'every created private public table must enable RLS without public policies');
console.log(`PASS static schema contract: ${result.tables.size} public tables inventoried, all private tables have RLS and no policies`);
console.log('PASS negative controls; live database permissions were not tested');
