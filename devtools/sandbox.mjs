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
    { id: 'r_s4', table_id: 'T5', guest_id: 'u_guest', status: 'confirmed', date: '2026-07-20', time_from: '19:00', time_to: '21:00', guests_count: 2, guest_name: 'Гость Тестовый', source: 'web' },
    { id: 'r_s5', table_id: 'T6', guest_id: 'u_guest', status: 'no_show',   date: '2026-05-20', time_from: '19:00', time_to: '21:00', guests_count: 2, guest_name: 'Гость Тестовый', source: 'phone_manual' },
    { id: 'r_s6', table_id: 'T4', guest_id: 'u_maria', status: 'completed', date: '2026-06-20', time_from: '21:00', time_to: '23:00', guests_count: 2, guest_name: 'Мария', source: 'telegram_bot' },
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
