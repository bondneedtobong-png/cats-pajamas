// VPS entry point for the API — wraps the same api/*.js handlers used on
// Vercel (handler(req, res), CORS/body-parsing already done inside each file
// via api/_lib/http.js) behind a persistent Express process instead of
// serverless functions. Handler code itself is untouched — only the
// transport changes. Static frontend (dist/) and TLS are nginx's job, not
// this process's — see HANDOFF_CATS_PAJAMAS.md "VPS-миграция".
import 'dotenv/config'; // must run before any api/_lib/*.js reads process.env at import time
import express from 'express';
import { EVENT_UPLOADS_DIR } from './api/_lib/eventPhotos.js';

import authHandler          from './api/auth.js';
import reservationsHandler  from './api/reservations.js';
import tablesHandler        from './api/tables.js';
import cocktailsHandler     from './api/cocktails.js';
import barMenuHandler       from './api/bar-menu.js';
import eventsHandler        from './api/events.js';
import reviewsHandler       from './api/reviews.js';
import teamHandler          from './api/team.js';
import applicationsHandler  from './api/applications.js';
import loyaltyHandler       from './api/loyalty.js';
import guestsHandler        from './api/guests.js';

const app = express();

// Фолбэк-раздача фото событий (план v4 §B). На проде их отдаёт nginx
// (^~ /uploads/events/ alias на персистентную папку вне релизов); этот роут —
// для локали и на случай, пока nginx не поправлен. Кэш как у ассетов.
app.use('/uploads/events', express.static(EVENT_UPLOADS_DIR, { maxAge: '365d', immutable: true, fallthrough: true }));

// Загрузка фото событий шлётся как base64 → поднимаем лимит тела ТОЧЕЧНО для
// /api/events (обычные роуты остаются на дефолтном ~100 КБ, меньше DoS-поверхность).
app.use('/api/events', express.json({ limit: '12mb' }));
app.use(express.json());

const routes = {
  '/api/auth': authHandler,
  '/api/reservations': reservationsHandler,
  '/api/tables': tablesHandler,
  '/api/cocktails': cocktailsHandler,
  '/api/bar-menu': barMenuHandler,
  '/api/events': eventsHandler,
  '/api/reviews': reviewsHandler,
  '/api/team': teamHandler,
  '/api/applications': applicationsHandler,
  '/api/loyalty': loyaltyHandler,
  '/api/guests': guestsHandler,
};

for (const [path, handler] of Object.entries(routes)) {
  app.all(path, (req, res) => {
    Promise.resolve(handler(req, res)).catch((e) => {
      console.error(`[server] unhandled error in ${path}:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка' });
    });
  });
}

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => console.log(`[server] API listening on 127.0.0.1:${PORT}`));
