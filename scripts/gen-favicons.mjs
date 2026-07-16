// Генерация растровых иконок из public/favicon.svg (фирменный знак «Пижама
// кота» — бокал на кремовом фоне). Google/Яндекс показывают иконку сайта в
// выдаче надёжнее из PNG, чем из SVG. Кремовый фон вшит в сам знак, поэтому
// подложку тут не добавляем. Запуск: node scripts/gen-favicons.mjs (нужен sharp).
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile('public/favicon.svg');
const targets = [
  ['public/favicon-48.png', 48],
  ['public/favicon-96.png', 96],
  ['public/favicon-192.png', 192],
  ['public/apple-touch-icon.png', 180], // iOS «на экран»
];
for (const [path, size] of targets) {
  await sharp(svg).resize(size, size).png().toFile(path);
  console.log('✓', path, size + 'px');
}
console.log('done');
