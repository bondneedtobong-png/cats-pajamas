// Песочница: РЕАЛЬНЫЙ Express-API проекта (server.js) поверх мини-PostgREST
// в памяти. Прод-БД не трогается. Telegram-токены не заданы — пуши тихо
// скипаются (мягкая деградация). Запуск из корня проекта:
//   node devtools/sandbox.mjs
// Затем фронт: VITE_API_BASE=http://127.0.0.1:3001 в .env.development.local,
// или curl с напечатанными ниже токенами.
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY = 'sandbox';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sandbox';
process.env.SESSION_SECRET = 'sandbox-secret';
process.env.TELEGRAM_ADMIN_IDS = '1186493444,814372718';
process.env.TELEGRAM_STAFF_IDS = '555000111';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.BOT_TOKEN;
delete process.env.TELEGRAM_STAFF_CHAT_ID;
process.env.PORT = '3001';

import { createDb, startPgrestMock } from './pgrest-mock.mjs';

// Сидовые пользователи. Добавляй сюда строки для новых таблиц при тестировании
// нового CRUD (например cocktails: [...], events: [...]).
const db = createDb({
  users: [
    { id: 'u_admin', name: 'Админ', phone: '79990000001', telegram_id: '1186493444', telegram_username: 'bond_admin', role: 'admin' },
    { id: 'u_guest', name: 'Гость Тестовый', phone: '79990000002', telegram_id: '424242', telegram_username: 'test_guest', role: 'guest' },
    { id: 'u_maria', name: 'Мария', phone: '79990000003', telegram_id: '333222', telegram_username: 'maria_jazz', role: 'guest' },
    { id: 'u_petr',  name: 'Пётр', phone: '79990000004', role: 'guest' },
  ],
  // Прошлые брони — чтобы вкладка ГОСТИ показывала разные уровни:
  // у Гостя Тестового 4 подтверждённых (уровень 3 «Вермут»), у Марии 1 («Вино»).
  reservations: [
    { id: 'r_s1', table_id: 'T2', guest_id: 'u_guest', status: 'completed', date: '2026-06-01', time_from: '19:00', time_to: '21:00', guests_count: 2, guest_name: 'Гость Тестовый', source: 'web' },
    { id: 'r_s2', table_id: 'T3', guest_id: 'u_guest', status: 'completed', date: '2026-06-08', time_from: '20:00', time_to: '22:00', guests_count: 3, guest_name: 'Гость Тестовый', source: 'telegram_bot' },
    { id: 'r_s3', table_id: 'T2', guest_id: 'u_guest', status: 'completed', date: '2026-06-15', time_from: '19:30', time_to: '21:30', guests_count: 2, guest_name: 'Гость Тестовый', source: 'web' },
    { id: 'r_s4', table_id: 'T5', guest_id: 'u_guest', status: 'confirmed', date: '2026-07-20', time_from: '19:00', time_to: '21:00', guests_count: 2, guest_name: 'Гость Тестовый', source: 'web', deposit_price: 1000, deposit_status: 'pending' },
    { id: 'r_s5', table_id: 'T6', guest_id: 'u_guest', status: 'no_show',   date: '2026-05-20', time_from: '19:00', time_to: '21:00', guests_count: 2, guest_name: 'Гость Тестовый', source: 'phone_manual' },
    { id: 'r_s6', table_id: 'T4', guest_id: 'u_maria', status: 'completed', date: '2026-06-20', time_from: '21:00', time_to: '23:00', guests_count: 2, guest_name: 'Мария', source: 'telegram_bot' },
  ],
  // Бармены — для проверки секции «Бармены» v2; тексты = боевые (team_update.sql)
  team_members: [
    { id: 'tm_s1', name: 'Шамусар', role: 'Старший бартендер', spec: 'Более 20 лет за стойкой', bio: 'Бар-менеджер Cat’s Pajamas и один из самых опытных барменов Самары — за стойкой больше двадцати лет. В профессию попал в Германии: в 2003-м пришёл в штутгартский бар помощником бармена — полгода учился, прежде чем ему доверили налить даже пиво. Дальше были отель в Измире, паб в Ташкенте, подвальный спикизи и тики-бар, свои сиропы и коктейли в бутылках. Момент озарения случился уже за стойкой: «я понял, для чего я стою за стойкой — за этой стойкой я обрёл себя».', quote: 'Пейте быстро, пока коктейль смеётся над вами!', quote_source: 'Гарри Крэддок, «The Savoy Cocktail Book»', photo_url: '/uploads/team/shamusar.jpg', sort_order: 0, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
    { id: 'tm_s2', name: 'Алексей', role: 'Винный эксперт', spec: 'Вино, аперитивы и дижестивы', bio: 'Человек, который отвечает в баре за всё, что налито из бутылки с пробкой. Подберёт вино под настроение, а не под этикетку, объяснит, чем вермут отличается от хереса и почему дижестив — лучшая точка в конце вечера. Не знаете, с чего начать винную страницу нашей карты — просто спросите Алексея.', quote: 'Вино. Одна из самых цивилизованных вещей на свете.', quote_source: 'Эрнест Хемингуэй, «Смерть после полудня»', photo_url: '/uploads/team/aleksey.jpg', sort_order: 1, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
    { id: 'tm_s3', name: 'Владислав', role: 'Бармен', spec: 'Классика и авторские рецептуры', bio: 'Хранитель классики: его Негрони и Олд Фэшн собраны по канону, без самодеятельности. Именно из уважения к классике рождаются его собственные твисты — когда знаешь правила, можно красиво их нарушать. Попросите сделать «как положено» — и поймёте, зачем эти коктейли пережили сто лет.', quote: 'Один мартини в самый раз, два слишком много, а три недостаточно.', quote_source: 'Джеймс Тёрбер', photo_url: '/uploads/team/vladislav.jpg', sort_order: 2, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
    { id: 'tm_s4', name: 'Денис', role: 'Бармен', spec: 'Тропические и фруктовые коктейли', bio: 'Отвечает за солнечную сторону карты: ананас, маракуйя, кокос и всё, что напоминает об отпуске. Верит, что тики-коктейль — это маленький отпуск минут на пятнадцать, и собирает его так, чтобы за окном перестала существовать зима. Если вечер нужно развернуть на сто восемьдесят градусов — вам к Денису.', quote: 'Ничто так не успокаивает дух, как ром и истинная вера.', quote_source: 'Джордж Байрон, «Дон Жуан»', photo_url: '/uploads/team/denis.jpg', sort_order: 3, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
    { id: 'tm_s5', name: 'Дмитрий', role: 'Бармен', spec: 'Авторские рецептуры', bio: 'Экспериментатор бара: пока другие полируют классику, он придумывает то, чего в книгах ещё нет. Настойки, необычные сиропы и сочетания, которые на бумаге выглядят спорно, а в бокале — убедительно. Почти каждый новый пункт в карте авторских — его рук дело.', quote: 'Всё вокруг меняется, это закон жизни.', quote_source: 'Форрест Бондурант, «Самый пьяный округ в мире»', photo_url: '/uploads/team/dmitriy.jpg', sort_order: 4, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
    { id: 'tm_s6', name: 'Егор', role: 'Бармен', spec: 'Джин и виски-коктейли', bio: 'Проводник по крепкой части карты: от можжевелового джина до торфяного виски. Любит рассказывать, чем Айла отличается от Спейсайда, но умеет и просто молча налить правильный дрэм. Если вы «не пьёте виски» — дайте ему один шанс вас переубедить.', quote: '«Белая Молния» входит, как нож, острым концом вперёд.', quote_source: 'Джек Бондурант, «Самый пьяный округ в мире»', photo_url: '/uploads/team/egor.jpg', sort_order: 5, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
  ],
  // События для витрины «Афиши» (план v4 §B): без фото / 1 фото / много фото.
  // Стенд-ин фото — статика команды (public/uploads/team) для локального превью.
  events: [
    { id: 'ev_demo0', title: 'Вечер винила', event_date: '2026-07-25', time: '20:00', description: 'Слушаем редкие пластинки джаза 50-х под бокал вермута.', image_url: '', image_urls: [] },
    { id: 'ev_demo1', title: 'Живой квартет Дмитриева', event_date: '2026-07-28', time: '21:00', description: 'Саксофон, контрабас и тёплый ламповый вечер прямо на сцене бара.', image_url: '/uploads/team/denis.jpg', image_urls: ['/uploads/team/denis.jpg'] },
    { id: 'ev_demo3', title: 'Большой джаз-джем', event_date: '2026-08-02', time: '22:00', description: 'Открытая сцена: приходи со своим инструментом и играй с нашими барменами.', image_url: '/uploads/team/egor.jpg', image_urls: ['/uploads/team/egor.jpg', '/uploads/team/dmitriy.jpg', '/uploads/team/vladislav.jpg', '/uploads/team/aleksey.jpg', '/uploads/team/shamusar.jpg'] },
  ],
  // Пара коктейлей — чтобы карусель «Напитков» на лендинге была не пустой
  cocktails: [
    { id: 'ck_s1', name: 'Clover Club Special', category: 'signature', ingredients: 'джин, малина, лайм, белок', story: 'Фирменный твист на классику 1900-х.', taste: 'ягодный, шелковистый', price: '750 ₽', image_url: '', sort_order: 0, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
    { id: 'ck_s2', name: 'Negroni', category: 'classics', ingredients: 'джин, красный вермут, биттер', story: 'Классика из Флоренции, 1919 год.', taste: 'горько-сладкий', price: '650 ₽', image_url: '', sort_order: 1, active: true, created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
  ],
});
globalThis.__sandboxDb = db;

await startPgrestMock(db, 54321);
console.log('[sandbox] mock PostgREST on 127.0.0.1:54321');

// Относительные импорты — файл живёт в devtools/, проект на уровень выше.
await import('../server.js');

const { issueToken } = await import('../api/_lib/session.js');
console.log('[sandbox] admin token:', issueToken('u_admin'));
console.log('[sandbox] guest token:', issueToken('u_guest'));
console.log('[sandbox] пример: curl -H "Authorization: Bearer <admin token>" http://127.0.0.1:3001/api/reservations');
