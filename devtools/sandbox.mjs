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
    { id: 'u_admin', name: 'Админ', phone: '79990000001', telegram_id: '1186493444', role: 'admin' },
    { id: 'u_guest', name: 'Гость Тестовый', phone: '79990000002', telegram_id: '424242', role: 'guest', loyalty_points: 20 },
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
