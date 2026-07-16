// Генерация растровых иконок из котика-фавикона на тёмном фирменном фоне.
// Google/Яндекс показывают иконку сайта в выдаче надёжнее из PNG, чем из SVG.
// Запуск: node scripts/gen-favicons.mjs (нужен sharp).
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

// Котик (пути из public/favicon.svg) на тёмном фоне со скруглением и отступом —
// так иконка читается как аккуратная плитка на белом фоне выдачи.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="13" fill="#1C101A"/>
  <g transform="translate(9.5,9.5) scale(0.703)">
    <path fill="#D4A843" d="M14 24 L10 6 L27 17 Q32 15 37 17 L54 6 L50 24 Q54 31 54 38 Q54 54 32 56 Q10 54 10 38 Q10 31 14 24 Z"/>
    <circle cx="24" cy="35" r="3" fill="#0C0A18"/>
    <circle cx="40" cy="35" r="3" fill="#0C0A18"/>
    <path fill="#0C0A18" d="M29 43 Q32 46 35 43 Z"/>
  </g>
</svg>`;

const buf = Buffer.from(ICON_SVG);
const targets = [
  ['public/favicon-48.png', 48],
  ['public/favicon-96.png', 96],
  ['public/favicon-192.png', 192],
  ['public/apple-touch-icon.png', 180], // iOS «на экран», без прозрачности
];
for (const [path, size] of targets) {
  await sharp(buf).resize(size, size).png().toFile(path);
  console.log('✓', path, size + 'px');
}
// Классический favicon.ico (многие краулеры всё ещё дёргают /favicon.ico)
await sharp(buf).resize(48, 48).toFormat('png').toFile('public/favicon-ico-src.png');
console.log('done');
