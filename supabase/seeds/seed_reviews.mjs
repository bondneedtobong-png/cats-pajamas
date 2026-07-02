// One-off seed script — run once Supabase is reachable. Idempotent: skips if
// the table already has rows.
//
// Run from the cats-pajamas-club project root:
//   node supabase/seeds/seed_reviews.mjs
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createReview, getReviews } = await import('../../api/_lib/reviews.js');

// Recovered from the old static reviewsData (data.js) — all real 5★ guest reviews.
const seed = [
  { author: 'Екатерина Х.', rating: 5, date: '2026-02-05',
    text: 'Восторг и любовь с первого взгляда! Бармены — волшебники, коктейли — шедевры. Лучший бар Самары на 100%.' },
  { author: 'Denis Menshikov', rating: 5, date: '2025-08-12',
    text: 'Атмосфера уютная, джаз на фоне, коктейли отменные. Один из лучших баров в городе — обязательно вернусь.' },
  { author: 'Наталья С.', rating: 5, date: '2025-09-20',
    text: 'Кровавая Мэри здесь просто 10 из 10. Персонал внимательный, атмосфера располагает к долгому вечеру.' },
];

const existing = await getReviews({ publicOnly: false });
if (existing.length > 0) {
  console.log(`Table already has ${existing.length} rows — skipping seed to avoid duplicates.`);
  process.exit(0);
}
for (const r of seed) {
  const created = await createReview(r);
  console.log('seeded:', created.id, created.author);
}
console.log('DONE —', seed.length, 'reviews seeded');
