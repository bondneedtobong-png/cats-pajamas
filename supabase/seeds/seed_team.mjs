// One-off seed script — run once Supabase is reachable. Idempotent: skips if
// the table already has rows.
//
// Run from the cats-pajamas-club project root:
//   node supabase/seeds/seed_team.mjs
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createTeamMember, getTeamMembers } = await import('../../api/_lib/team.js');

// Recovered from the old static teamData (data.js) — 6 real bartenders w/ photos+quotes.
const seed = [
  { name: 'Шамусар',  role: 'Старший бартендер', spec: 'Более 20 лет за стойкой',
    quote: '«Коктейль — это точная наука с душой импровизации»', photoUrl: '/uploads/team/shamusar.jpg' },
  { name: 'Алексей',  role: 'Винный эксперт', spec: 'Вино, аперитивы и дижестивы',
    quote: '«Каждый напиток — это история урожая и земли»', photoUrl: '/uploads/team/aleksey.jpg' },
  { name: 'Владислав', role: 'Бармен', spec: 'Классика и авторские рецептуры',
    quote: '«Стиль не в галстуке — в том, что ты наливаешь»', photoUrl: '/uploads/team/vladislav.jpg' },
  { name: 'Денис', role: 'Бармен', spec: 'Тропические и фруктовые коктейли',
    quote: '«Хороший коктейль — это момент, который хочется повторить»', photoUrl: '/uploads/team/denis.jpg' },
  { name: 'Дмитрий', role: 'Бармен', spec: 'Авторские рецептуры',
    quote: '«Ночь становится историей после первого глотка»', photoUrl: '/uploads/team/dmitriy.jpg' },
  { name: 'Егор', role: 'Бармен', spec: 'Джин и виски-коктейли',
    quote: '«Каждый гость заслуживает своего идеального бокала»', photoUrl: '/uploads/team/egor.jpg' },
];

const existing = await getTeamMembers({ activeOnly: false });
if (existing.length > 0) {
  console.log(`Table already has ${existing.length} rows — skipping seed to avoid duplicates.`);
  process.exit(0);
}
for (const m of seed) {
  const created = await createTeamMember(m);
  console.log('seeded:', created.id, created.name);
}
console.log('DONE —', seed.length, 'team members seeded');
