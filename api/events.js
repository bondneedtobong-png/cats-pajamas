import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getEvents, createEvent, updateEvent, deleteEvent } from './_lib/events.js';
import { saveEventPhoto, deleteEventPhoto, MAX_SOURCE_BYTES } from './_lib/eventPhotos.js';

// Декод base64 (с data-URL префиксом или без) → Buffer, с проверкой размера.
function decodeBase64Image(b64) {
  if (typeof b64 !== 'string' || !b64) throw new Error('пустой файл');
  const comma = b64.indexOf(',');
  const raw = b64.startsWith('data:') && comma >= 0 ? b64.slice(comma + 1) : b64;
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new Error('пустой файл');
  if (buf.length > MAX_SOURCE_BYTES) throw new Error('файл больше 10 МБ');
  return buf;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: events list (public = upcoming only; admin = everything) ────
    if (req.method === 'GET') {
      const { admin } = req.query;
      if (admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        return ok(res, { events: await getEvents({ upcomingOnly: false }) });
      }
      return ok(res, { events: await getEvents({ upcomingOnly: true }) });
    }

    // ─── POST: admin CRUD + фото ───────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      switch (body.action) {
        case 'create': return ok(res, { event: await createEvent(body.data || {}) });
        case 'update': return ok(res, { event: await updateEvent(body.id, body.data || {}) });
        case 'delete': await deleteEvent(body.id); return ok(res, {});
        case 'upload_photo': {
          if (!body.eventId) return badRequest(res, 'Не указан id события');
          const buf = decodeBase64Image(body.imageBase64);
          const saved = await saveEventPhoto(body.eventId, buf);
          return ok(res, { url: saved.url, thumbUrl: saved.thumbUrl });
        }
        case 'delete_photo': {
          if (!body.eventId || !body.url) return badRequest(res, 'Не указан id или ссылка');
          await deleteEventPhoto(body.eventId, body.url);
          return ok(res, {});
        }
        default: return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязательн|не найдено|пустой файл|больше|фото/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
