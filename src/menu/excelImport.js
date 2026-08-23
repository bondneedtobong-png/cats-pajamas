import { readWorkbook } from './xlsx.js';

// Импорт барной карты из Excel-книги владельца («Меню 26.06 Дизайнеру.xlsx»).
// Разбор идёт по форме таблицы, а не по жёстким адресам ячеек — владелец
// правит файл руками, колонки и строки в нём переезжают.
//
// Что как читается:
//   • строка с ценой                → позиция. Колонка названия: «Название⎵⎵
//     страна/состав» (разделитель — ДВА и более пробела), объём — ячейка вида
//     «40 мл.», цена — последняя числовая («500», «300/600 р.»).
//   • строка без цены, только текст → заголовок. Уровень заголовка берём из
//     размера шрифта: самый крупный — название листа, средний — группа,
//     мелкий — категория (см. weight в xlsx.js).
//   • лист-«пары» (карта коктейлей) → строка с ценой + следующая строка без
//     цены = состав коктейля. Определяется автоматически по чередованию.
//   • длинный текст в дальней колонке → описание раздела: оно попадает в
//     панель «О разделе» (stories) на сайте.
//   • заголовок-«надгруппа» из списка SUBGROUPS → третий уровень: идущие под
//     ним разделы получают parent («Виски» → Шотландия/Ирландия/…).

const RUB = '₽';
const NBSP = ' ';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isVolume = (s) => /\d/.test(s) && /(мл|л\.|гр|г\.|шт)/i.test(s);
// Цена — ячейка целиком из числа (возможно «300/600» и с «р.»/«₽»), а не любая
// с цифрой: в дальней колонке рядом стоит цитата с годом («…, 1887»), и по
// «есть цифра» она однажды уехала в цену вместо неё (файл владельца, июнь).
const isPrice = (s) => /^\d[\d\s.,/]*\s*(р\.?|руб\.?|₽)?$/i.test(clean(s));
const norm = (s) => clean(s).toLowerCase().replace(/ё/g, 'е');
const slug = (s) => norm(s).replace(/[^a-zа-я0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'g';

// Надгруппы: заголовок, под которым идёт несколько разделов одного рода
// («Виски» над Шотландией, Ирландией, Америкой и «Виски со Всего Мира»).
// Общего сигнала для них в книге нет: дочерние заголовки набраны ровно так же,
// как соседние разделы (Джин, Коньяк…), а конец блока ничем не помечен —
// проверено на файле владельца (styles.xml: ни отступов, ни outline level).
// Поэтому список известных надгрупп явный: сверяем по нормализованному тексту.
// Незнакомые надгруппы по-прежнему не гадаем — см. предупреждение ниже.
const SUBGROUPS = [
  { title: 'Виски', children: ['Шотландия', 'Ирландия', 'Америка', 'Виски со Всего Мира'] },
];
const SUBGROUP_BY_TITLE = new Map(SUBGROUPS.map((s) => [
  norm(s.title),
  { title: s.title, children: new Set(s.children.map(norm)) },
]));

/** «500» → «500 ₽»; «300/600 р.» → «300/600 ₽»; всё прочее — как есть. */
function price(raw) {
  const v = clean(raw);
  if (!v) return '';
  const num = Number(v.replace(',', '.'));
  if (Number.isFinite(num) && /^\d+([.,]\d+)?$/.test(v)) {
    return Math.round(num).toLocaleString('ru-RU').replace(/\s/g, NBSP) + NBSP + RUB;
  }
  return v.replace(/\s*(р\.?|руб\.?|₽)\s*$/i, '').trim() + NBSP + RUB;
}

/** «40 мл.» → «40 мл» (точка на карточке лишняя). */
const volume = (raw) => clean(raw).replace(/\.$/, '');

/** «Chairman's Reserve Spiced⎵⎵⎵Сент-Люсия» → name + origin. */
function splitName(raw) {
  const parts = String(raw).split(/\s{2,}/).map(clean).filter(Boolean);
  if (parts.length < 2) return { name: clean(raw), origin: '' };
  return { name: parts[0], origin: parts.slice(1).join(', ') };
}

/** Разбирает строку листа: позиция (есть цена) или заголовок. */
function readRow(row) {
  const a = row.cells.A || '';
  const rest = Object.entries(row.cells)
    .filter(([col]) => col !== 'A')
    .sort(([x], [y]) => (x.length - y.length) || x.localeCompare(y))
    .map(([, v]) => v);

  const vol = rest.find(isVolume) || '';
  const money = rest.filter((v) => v !== vol && isPrice(v)).pop() || '';
  // Дальняя длинная ячейка без цены — описание/цитата раздела.
  const note = rest.find((v) => v !== vol && v !== money && clean(v).length > 30) || '';

  if (!money) return { kind: 'head', text: clean(a), note: clean(note), weight: row.weight };
  const { name, origin } = splitName(a);
  return {
    kind: 'item',
    weight: row.weight,
    note: clean(note),
    item: {
      name,
      ...(origin ? { origin } : {}),
      ...(vol ? { volume: volume(vol) } : {}),
      price: price(money),
    },
  };
}

/**
 * Лист-«пары»: строка позиции, под ней строка-состав без цены (карта
 * коктейлей). Отличаем от листа с заголовками разделов по тому, что почти
 * каждая строка без цены стоит вплотную под строкой с ценой.
 */
function isPairsSheet(rows, parsed) {
  const heads = parsed.filter((p) => p.kind === 'head');
  const items = parsed.filter((p) => p.kind === 'item');
  if (heads.length < 3 || items.length < 3) return false;
  let after = 0;
  parsed.forEach((p, i) => {
    if (p.kind !== 'head' || i === 0) return;
    if (parsed[i - 1].kind === 'item' && rows[i].r === rows[i - 1].r + 1) after += 1;
  });
  return after / heads.length > 0.7 && heads.length >= items.length * 0.7;
}

/** Один объём на всю категорию → выносим в unit, из позиций убираем. */
function foldUnit(cat) {
  const vols = cat.items.map((i) => i.volume || '');
  if (vols.length > 1 && vols.every((v) => v && v === vols[0])) {
    cat.unit = vols[0];
    cat.items.forEach((i) => { delete i.volume; });
  }
  return cat;
}

/** Лист книги → группы. Экспортируется ради devtools/menu_import_test.mjs. */
export function buildSheet(sheet, warnings) {
  const rows = sheet.rows;
  const parsed = rows.map(readRow);
  const pairs = isPairsSheet(rows, parsed);

  // Уровни заголовков по размеру шрифта: крупнее — выше в иерархии.
  const heads = parsed.filter((p) => p.kind === 'head' && p.text);
  const levels = [...new Set(heads.map((h) => h.weight))].sort((a, b) => b - a);
  const first = parsed[0];
  // Первая строка листа, набранная самым крупным шрифтом, — его название.
  const sheetTitle = first && first.kind === 'head' && levels.length > 1 && first.weight === levels[0]
    ? first.text : '';
  const rest = sheetTitle ? levels.slice(1) : levels;
  const groupWeight = rest.length > 1 ? rest[0] : null;
  // Группа по умолчанию — имя вкладки книги, раздел по умолчанию — строка-
  // название листа: на листе без заголовков разделов (карта коктейлей) так не
  // получается «Коктейльная карта» внутри «Коктейльной карты».
  const fallbackGroup = clean(sheet.name) || sheetTitle;
  const fallbackCat = sheetTitle || clean(sheet.name);

  const groups = [];
  let group = null;
  let cat = null;
  let lastItem = null;
  let subgroup = null;       // открытая надгруппа из SUBGROUPS (пока идут её разделы)
  let subgroupEmpty = false; // её заголовок прочитан, но ни одного раздела ещё нет

  const openGroup = (title) => {
    group = { id: slug(title), title, categories: [] };
    groups.push(group);
    cat = null;
  };
  // parent — название надгруппы («Виски»), если раздел вложен в неё третьим
  // уровнем. Категории остаются плоским списком по порядку файла: связь с
  // надгруппой держит поле parent, а не вложенный массив (так все читатели
  // карты — сайт, /menu, пререндер, редактор — продолжают работать как были).
  const openCat = (title, parent = '') => {
    if (!group) openGroup(fallbackGroup);
    cat = { title, ...(parent ? { parent } : {}), items: [], story: '' };
    group.categories.push(cat);
  };

  parsed.forEach((p, i) => {
    if (p.kind === 'item') {
      // Позиция сразу под заголовком надгруппы, без заголовка раздела: значит
      // в этом файле «Виски» — обычный раздел, а не третий уровень.
      if (subgroupEmpty) { openCat(subgroup.title); subgroup = null; subgroupEmpty = false; }
      if (!cat) openCat(fallbackCat);
      cat.items.push(p.item);
      lastItem = p.item;
      if (p.note && !cat.story) cat.story = p.note;
      return;
    }
    if (!p.text) return;
    if (i === 0 && p.text === sheetTitle) return; // строка-название листа

    // Состав коктейля строкой ниже позиции.
    if (pairs && lastItem && !lastItem.origin && parsed[i - 1] && parsed[i - 1].kind === 'item') {
      lastItem.origin = p.text;
      if (p.note && cat && !cat.story) cat.story = p.note;
      return;
    }

    // Надгруппа из списка: сам заголовок разделом не становится — он лишь
    // открывает третий уровень для следующих за ним знакомых разделов.
    const known = SUBGROUP_BY_TITLE.get(norm(p.text));
    if (known) { subgroup = known; subgroupEmpty = true; lastItem = null; return; }
    if (subgroup && subgroup.children.has(norm(p.text))) {
      openCat(p.text, subgroup.title);
      subgroupEmpty = false;
      lastItem = null;
      if (p.note && cat && !cat.story) cat.story = p.note;
      return;
    }
    subgroup = null; subgroupEmpty = false; // чужой заголовок — блок надгруппы кончился

    if (groupWeight !== null && p.weight === groupWeight) openGroup(p.text);
    else openCat(p.text);
    lastItem = null;
    if (p.note && cat && !cat.story) cat.story = p.note;
  });

  // Незнакомый (не из SUBGROUPS) заголовок-«надгруппа» посреди листа режет
  // список так, что ВСЁ идущее после него попадает в эту группу — включая
  // соседние разделы (Джин, Коньяк…): где кончается его блок,
  // в таблице ничем не помечено. Если до него уже были категории, такой
  // группировке верить нельзя — сводим лист в одну группу и говорим об этом.
  if (groupWeight !== null && groups.length > 1 && groups[0].title === fallbackGroup) {
    const flat = { id: slug(fallbackGroup), title: fallbackGroup, categories: [...groups[0].categories] };
    groups.slice(1).forEach((g) => {
      const names = g.categories.slice(0, 4).map((c) => c.title).join(', ');
      warnings.push(
        `Лист «${sheet.name}»: «${g.title}» — незнакомый заголовок над несколькими разделами, ` +
        'но где его блок кончается, в таблице не помечено. Группу не создавали, ' +
        `разделы (${names}…) в общем списке. Сгруппировать или переименовать — в редакторе.`,
      );
      flat.categories.push(...g.categories);
    });
    return [flat];
  }

  return groups;
}

/**
 * Excel-книга (ArrayBuffer или File) → { menu, stories, report }.
 * `keepStories` — тексты «О разделе», уже написанные владельцем: если в файле
 * описания для раздела нет, старое сохраняется (совпадение по названию).
 */
export async function importMenuFromExcel(source, keepStories = {}) {
  const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const sheets = await readWorkbook(buf);

  const warnings = [];
  const groups = [];
  for (const sheet of sheets) {
    if (!sheet.rows.length) continue;
    groups.push(...buildSheet(sheet, warnings));
  }

  const kept = new Map(Object.entries(keepStories || {}).map(([k, v]) => [norm(k), v]));
  const stories = {};
  const seenId = new Set();
  const menu = [];

  for (const g of groups) {
    const categories = g.categories
      .filter((c) => c.items.length)
      .map((c) => {
        const story = clean(c.story) || kept.get(norm(c.title)) || '';
        if (story) stories[c.title] = story;
        return foldUnit({ title: c.title, ...(c.parent ? { parent: c.parent } : {}), items: c.items });
      });
    if (!categories.length) continue;
    let id = g.id;
    while (seenId.has(id)) id = `${g.id}-${menu.length}`;
    seenId.add(id);
    menu.push({ id, title: g.title, categories });
  }

  if (!menu.length) throw new Error('В файле не нашлось ни одной позиции с ценой — проверьте, тот ли это файл.');

  const report = {
    sheets: sheets.map((s) => s.name),
    groups: menu.length,
    categories: menu.reduce((n, g) => n + g.categories.length, 0),
    items: menu.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.items.length, 0), 0),
    stories: Object.keys(stories).length,
    warnings,
  };
  return { menu, stories, report };
}
