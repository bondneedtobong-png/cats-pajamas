// VPS entry point for the API — wraps the same api/*.js handlers used on
// Vercel (handler(req, res), CORS/body-parsing already done inside each file
// via api/_lib/http.js) behind a persistent Express process instead of
// serverless functions. Handler code itself is untouched — only the
// transport changes. Static frontend (dist/) and TLS are nginx's job, not
// this process's — see HANDOFF_CATS_PAJAMAS.md "VPS-миграция".
import 'dotenv/config'; // must run before any api/_lib/*.js reads process.env at import time
import express from 'express';

import authHandler          from './api/auth.js';
import reservationsHandler  from './api/reservations.js';
import tablesHandler        from './api/tables.js';
import cocktailsHandler     from './api/cocktails.js';
import eventsHandler        from './api/events.js';
import reviewsHandler       from './api/reviews.js';
import teamHandler          from './api/team.js';
import applicationsHandler  from './api/applications.js';
import loyaltyHandler       from './api/loyalty.js';
import guestsHandler        from './api/guests.js';

const app = express();
app.use(express.json());

const routes = {
  '/api/auth': authHandler,
  '/api/reservations': reservationsHandler,
  '/api/tables': tablesHandler,
  '/api/cocktails': cocktailsHandler,
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
