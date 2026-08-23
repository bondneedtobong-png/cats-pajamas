// Заливает барную карту из .xlsx в песочницу (devtools/sandbox.mjs) через
// НАСТОЯЩИЙ API проекта — POST /api/bar-menu с админским токеном. Нужен, чтобы
// смотреть книгу-меню и /menu на реальных данных владельца, не трогая прод.
//
//   node devtools/sandbox.mjs                       # в соседнем окне, печатает токен
//   node devtools/seed_bar_menu.mjs <admin токен> [путь к .xlsx] [база API]
//
// По умолчанию берёт фикстуру devtools/seed/menu-26.06.xlsx и API на 3001.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importMenuFromExcel } from '../src/menu/excelImport.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [token, file = join(root, 'devtools', 'seed', 'menu-26.06.xlsx'), api = 'http://127.0.0.1:3001'] = process.argv.slice(2);

if (!token) {
  console.error('Укажите админский токен из вывода sandbox.mjs');
  process.exit(1);
}

const b = await readFile(file);
const { menu, stories, report } = await importMenuFromExcel(
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
);

const res = await fetch(`${api}/api/bar-menu`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ action: 'save', data: { menu, stories } }),
});

if (!res.ok) {
  console.error('Не сохранилось:', res.status, (await res.text()).slice(0, 300));
  process.exit(1);
}
console.log(`Залито в песочницу: групп ${report.groups}, разделов ${report.categories}, позиций ${report.items}`);
