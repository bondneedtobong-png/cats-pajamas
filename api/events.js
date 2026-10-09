import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getEvents, createEvent, updateEvent, deleteEvent } from './_lib/events.js';
import { saveEventPhoto, deleteEventPhoto, MAX_SOURCE_BYTES } from './_lib/eventPhotos.js';
import { supabase } from './_lib/supabase.js';

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

    // ─── GET: список событий ──────────────────────────────────────────────
    // admin=1        — всё, включая скрытые (гейт admin);
    // scope=public   — всё активное (сайт делит на «Грядущие/Прошедшие» сам);
    // scope=past     — только прошедшие;
    // без параметров — как раньше, ближайшие (на этом сидят бот и старые вызовы).
    if (req.method === 'GET') {
      const { admin, scope } = req.query;
      if (admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        return ok(res, { events: await getEvents({ scope: 'admin' }) });
      }
      const publicScope = scope === 'public' || scope === 'past' ? scope : 'upcoming';
      return ok(res, { events: await getEvents({ scope: publicScope }) });
    }

    // ─── POST: admin CRUD + фото ───────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      switch (body.action) {
        case 'create': return ok(res, { event: await createEvent(body.data || {}) });
        case 'update': return ok(res, { event: await updateEvent(body.id, body.data || {}) });
        case 'delete': return ok(res, await deleteEvent(body.id));
        case 'upload_photo': {
          if (!body.eventId) return badRequest(res, 'Не указан id события');
          const buf = decodeBase64Image(body.imageBase64);
          const saved = await saveEventPhoto(body.eventId, buf);
          return ok(res, { url: saved.url, thumbUrl: saved.thumbUrl });
        }
        case 'delete_photo': {
          if (!body.eventId || !body.url) return badRequest(res, 'Не указан id или ссылка');
          // Duplicated events share URLs. Also protect uploads from cancellation
          // if a save committed but its HTTP response never reached the editor.
          const [arrayRefs, legacyRefs] = await Promise.all([
            supabase.from('events').select('id').contains('image_urls', [body.url]).limit(1),
            supabase.from('events').select('id').eq('image_url', body.url).limit(1),
          ]);
          if (arrayRefs.error || legacyRefs.error) throw new Error('Не удалось проверить ссылки события');
          if (arrayRefs.data?.length || legacyRefs.data?.length) return ok(res, { retained: true });
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
