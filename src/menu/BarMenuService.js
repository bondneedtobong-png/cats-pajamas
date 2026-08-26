import { apiFetch } from '../api.js';
import { BAR_MENU, CATEGORY_STORIES } from './barMenuData.js';
import { applySubgroups } from './subgroups.js';

// Барная карта на клиенте: публичное чтение с фолбэком на статику + админское
// сохранение. Статика (barMenuData.js) служит и мгновенным первым рендером,
// и страховкой при недоступном API — сайт никогда не остаётся без меню.
const BarMenuService = {
  /** Мгновенный дефолт для инициализации стейта (без сетевого запроса). */
  fallback() {
    return { menu: applySubgroups(BAR_MENU), stories: CATEGORY_STORIES };
  },

  /** Публичная карта из БД; при любой ошибке — статический фолбэк. */
  async getPublic() {
    try {
      const d = await apiFetch('/api/bar-menu', { auth: false });
      if (Array.isArray(d?.menu) && d.menu.length) {
        // applySubgroups — страховка для карты, залитой до третьего уровня:
        // «Шотландия/Ирландия/…» получают parent «Виски» уже на чтении.
        return { menu: applySubgroups(d.menu), stories: d.stories && typeof d.stories === 'object' ? d.stories : {} };
      }
    } catch { /* ниже — фолбэк */ }
    return { menu: applySubgroups(BAR_MENU), stories: CATEGORY_STORIES };
  },

  /** Админское сохранение всей карты одним блобом. */
  async save(data) {
    const d = await apiFetch('/api/bar-menu', { method: 'POST', body: { action: 'save', data } });
    if (!Array.isArray(d?.menu)) throw new Error('Некорректный ответ сервера');
    return { menu: d.menu, stories: d.stories && typeof d.stories === 'object' ? d.stories : {} };
  },
};

export default BarMenuService;
