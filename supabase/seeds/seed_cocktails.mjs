// One-off seed script — run once Supabase is reachable (tables created but
// empty, e.g. right after `supabase/schema.sql`, or after recovering from an
// outage). Idempotent: skips if the table already has rows.
//
// Run from the cats-pajamas-club project root:
//   node supabase/seeds/seed_cocktails.mjs
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createCocktail, getCocktails } = await import('../../api/_lib/cocktails.js');

const seed = [
  {
    name: 'Gimlet', category: 'classics',
    ingredients: 'Джин London Dry, свежий сок лайма, сахарный сироп',
    story: 'Придуман британскими морскими офицерами XIX века, которые смешивали джин с лаймовым соком, чтобы бороться с цингой в дальних плаваниях. С тех пор — эталон строгости и баланса.',
    taste: 'Терпкий, цитрусовый, освежающий',
    price: '900 ₽', imageUrl: '',
  },
  {
    name: 'Clover Club', category: 'classics',
    ingredients: 'Джин London Dry, свежая малина, лимонный сок, малиновый сироп, яичный белок',
    story: 'Коктейль родом из одноимённого джентльменского клуба Филадельфии начала XX века. Яичный белок даёт бархатную пену, а малина — мягкую кислинку без лишней сладости.',
    taste: 'Кисло-сладкий, ягодный, бархатистый',
    price: '880 ₽', imageUrl: '/uploads/team/clover-club.jpg',
  },
  {
    name: 'Bloody Mary', category: 'classics',
    ingredients: 'Водка, томатный сок, соус табаско, специи',
    story: 'Легенда приписывает создание бармену парижского Harry’s New York Bar в 1920-х: смесь водки и томатного сока быстро стала утренней классикой во всём мире.',
    taste: 'Пряный, острый, пикантный',
    price: '820 ₽', imageUrl: '',
  },
  {
    name: 'Old Fashioned', category: 'classics',
    ingredients: 'Бурбон, ангостура биттер, тростниковый сахар',
    story: 'Один из старейших коктейлей в истории — рецепт почти не менялся с 1880-х. Простая формула виски, сахара и биттера, доведённая до совершенства.',
    taste: 'Крепкий, горько-сладкий, дымный',
    price: '950 ₽', imageUrl: '',
  },
  {
    name: "Cat's Midnight", category: 'signature',
    ingredients: 'Тёмный ром, колд-брю кофе, горький шоколад, соль',
    story: 'Придуман нашими барменами как фирменный ночной коктейль клуба — тёмный ром и кофе для тех, кто не хочет, чтобы ночь заканчивалась.',
    taste: 'Кофейный, шоколадный, с лёгкой дымной солью',
    price: '990 ₽', imageUrl: '',
  },
  {
    name: 'Purple Rain', category: 'signature',
    ingredients: 'Фиолетовый джин, лаванда, лимон, фиалковый ликёр',
    story: 'Названа в честь фиолетовой темы бара — лавандово-фиалковый коктейль, который стал визитной карточкой вечерних выступлений.',
    taste: 'Цветочный, освежающий, с лёгкой кислинкой',
    price: '980 ₽', imageUrl: '',
  },
  {
    name: 'Amber Club', category: 'signature',
    ingredients: 'Односолодовый виски, мёд, тимьян, лимон, биттер',
    story: 'Дань джентльменским клубам старого стиля: односолодовый виски с мёдом и тимьяном для неспешного вечера.',
    taste: 'Тёплый, медовый, травяной',
    price: '1 050 ₽', imageUrl: '',
  },
  {
    name: 'Jazz Night', category: 'signature',
    ingredients: 'Мескаль, грейпфрут, агава, чили, базилик',
    story: 'Дымный мескаль и грейпфрут с чили — коктейль для тех, кто пришёл на живой джаз до утра.',
    taste: 'Дымный, цитрусовый, острый',
    price: '1 100 ₽', imageUrl: '',
  },
];

const existing = await getCocktails({ activeOnly: false });
if (existing.length > 0) {
  console.log(`Table already has ${existing.length} rows — skipping seed to avoid duplicates.`);
  process.exit(0);
}
for (const c of seed) {
  const created = await createCocktail(c);
  console.log('seeded:', created.id, created.name);
}
console.log('DONE —', seed.length, 'cocktails seeded');
