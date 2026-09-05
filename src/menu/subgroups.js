// Надгруппы барной карты — третий уровень вложенности.
//
// В Excel владельца надгруппа выглядит как обычный заголовок раздела («Виски»),
// под которым идут её разделы (Шотландия, Ирландия, …). Никакого признака в
// файле нет — ни жирности, ни отступа, — поэтому список задан явно. Импортёр
// (excelImport.js) по нему проставляет categories[].parent.
//
// ⚠️ Карта в проде залита ДО появления третьего уровня, там parent пуст. Пока
// владелец не переимпортировал файл, тот же список чинит данные на чтении
// (applySubgroups в BarMenuService) — иначе «Шотландия/Ирландия/Америка/Виски
// со Всего Мира» снова расползаются на четыре пузыря вместо одного «Виски».
// После переимпорта fallback просто ничего не находит и молчит.

export const SUBGROUPS = [
  { title: 'Виски', children: ['Шотландия', 'Ирландия', 'Америка', 'Со всего мира', 'Виски со Всего Мира'] },
];

/** Нормализация названия для сравнения: регистр, ё/е и лишние пробелы не важны. */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export const SUBGROUP_BY_TITLE = new Map(SUBGROUPS.map((s) => [
  norm(s.title),
  { title: s.title, children: new Set(s.children.map(norm)) },
]));

/** Надгруппа, которой принадлежит раздел, или '' — если раздел сам по себе. */
export function parentOf(title) {
  const t = norm(title);
  for (const s of SUBGROUPS) if (s.children.some((c) => norm(c) === t)) return s.title;
  return '';
}

/**
 * Проставить parent там, где его нет (карта из БД старого формата).
 * Возвращает НОВЫЙ массив, исходный не трогаем: карту в админке правят по
 * ссылке на тот же объект.
 */
export function applySubgroups(menu) {
  if (!Array.isArray(menu)) return menu;
  return menu.map((group) => ({
    ...group,
    categories: (group.categories || []).map((cat) => {
      if (cat.parent) return cat;
      const parent = parentOf(cat.title);
      return parent ? { ...cat, parent } : cat;
    }),
  }));
}
