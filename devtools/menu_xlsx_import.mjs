// Прогон импорта барной карты из Excel без браузера: печатает дерево
// групп/категорий и найденные проблемы. Запуск:
//   node devtools/menu_xlsx_import.mjs "путь/к/Меню.xlsx"
import { readFile } from 'node:fs/promises';
import { importMenuFromExcel } from '../src/menu/excelImport.js';

const path = process.argv[2];
if (!path) { console.error('Укажите путь к .xlsx'); process.exit(1); }

const b = await readFile(path);
const { menu, stories, report } = await importMenuFromExcel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

console.log('Листы:', report.sheets.join(' | '));
console.log(`Групп: ${report.groups}, категорий: ${report.categories}, позиций: ${report.items}, описаний: ${report.stories}\n`);
for (const g of menu) {
  console.log(`■ ${g.title}  [${g.id}]`);
  let sub = '';
  for (const c of g.categories) {
    if (c.parent !== sub) { sub = c.parent || ''; if (sub) console.log(`   ▸ ${sub}`); }
    const st = stories[c.title] ? ` · о разделе: «${stories[c.title].slice(0, 50)}…»` : '';
    const pad = c.parent ? '      ' : '   ';
    console.log(`${pad}· ${c.title} — ${c.items.length} поз.${c.unit ? ` (объём ${c.unit})` : ''}${st}`);
  }
}
console.log('\nПримеры позиций:');
for (const g of menu) for (const c of g.categories.slice(0, 2)) for (const it of c.items.slice(0, 2)) {
  console.log(`   ${c.title}: ${JSON.stringify(it)}`);
}
if (report.warnings.length) { console.log('\nПредупреждения:'); report.warnings.forEach((w) => console.log(' !', w)); }
