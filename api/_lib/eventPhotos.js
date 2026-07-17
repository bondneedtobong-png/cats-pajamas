import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

// Фото событий: файлы на диске (персистентная папка ВНЕ релизов — деплой
// атомарный, всё в dist/ пропадает при флипе симлинка; см. HANDOFF §B).
// sharp жмёт в webp два размера: <n>.webp (~1600px) и <n>.thumb.webp (~480px).
// В БД (events.image_urls) пишем абсолютные веб-пути /uploads/events/<id>/<n>.webp —
// их отдаёт nginx (^~ /uploads/events/ alias) или express.static-фолбэк server.js.
//
// Всё best-effort на удаление; сохранение бросает при сбое (вызывающий покажет
// дружелюбную ошибку). Порядок фото — в массиве image_urls (БД), не в именах.

export const EVENT_UPLOADS_DIR =
  process.env.EVENT_UPLOADS_DIR || path.resolve(process.cwd(), 'uploads-runtime/events');

export const MAX_PHOTOS = 10;
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 10 МБ на исходник

const URL_BASE = '/uploads/events';

function eventDir(eventId) {
  // eventId генерим сами (ev_...) — но подстрахуемся от обхода каталогов.
  const safe = String(eventId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('bad eventId');
  return path.join(EVENT_UPLOADS_DIR, safe);
}

/** Публичный путь основного фото → путь его миниатюры (соглашение об именах). */
export function thumbUrl(url) {
  return typeof url === 'string' ? url.replace(/\.webp$/, '.thumb.webp') : url;
}

/** Индекс из имени: /uploads/events/<id>/3.webp → 3 (или null). */
function indexFromUrl(url) {
  const m = String(url).match(/\/(\d+)\.webp$/);
  return m ? Number(m[1]) : null;
}

/** Существующие индексы фото события (по файлам <n>.webp, без thumb). */
async function existingIndices(eventId) {
  try {
    const files = await fs.readdir(eventDir(eventId));
    return files.map(f => (f.match(/^(\d+)\.webp$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  } catch { return []; }
}

/**
 * Сохранить одно фото события. Возвращает { url, thumbUrl, index }.
 * @param {string} eventId  — id события (папка)
 * @param {Buffer} buffer   — исходные байты (jpeg/png/webp из Telegram или base64)
 */
export async function saveEventPhoto(eventId, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('пустой файл');
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error('файл больше 10 МБ');
  const dir = eventDir(eventId);
  await fs.mkdir(dir, { recursive: true });

  const idx = await existingIndices(eventId);
  if (idx.length >= MAX_PHOTOS) throw new Error(`не больше ${MAX_PHOTOS} фото на событие`);
  const n = idx.length ? idx[idx.length - 1] + 1 : 0;

  const base = sharp(buffer, { failOn: 'none' }).rotate(); // rotate() — учесть EXIF-ориентацию
  const mainBuf = await base.clone()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 }).toBuffer();
  const thumbBuf = await base.clone()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 }).toBuffer();

  await fs.writeFile(path.join(dir, `${n}.webp`), mainBuf);
  await fs.writeFile(path.join(dir, `${n}.thumb.webp`), thumbBuf);

  const url = `${URL_BASE}/${String(eventId).replace(/[^a-zA-Z0-9_-]/g, '')}/${n}.webp`;
  return { url, thumbUrl: thumbUrl(url), index: n };
}

/** Удалить одно фото (основное + миниатюру) по его публичному пути. Best-effort. */
export async function deleteEventPhoto(eventId, url) {
  const n = indexFromUrl(url);
  if (n == null) return;
  const dir = eventDir(eventId);
  await fs.rm(path.join(dir, `${n}.webp`), { force: true }).catch(() => {});
  await fs.rm(path.join(dir, `${n}.thumb.webp`), { force: true }).catch(() => {});
}

/** Удалить все фото события (папку целиком). Best-effort — не роняет удаление события. */
export async function deleteEventPhotos(eventId) {
  await fs.rm(eventDir(eventId), { recursive: true, force: true }).catch(() => {});
}

/** Абсолютный путь основного файла фото на диске (для отправки в Telegram через InputFile). */
export function photoFilePath(url) {
  const m = String(url).match(/\/uploads\/events\/([^/]+)\/(\d+)\.webp$/);
  if (!m) return null;
  return path.join(eventDir(m[1]), `${m[2]}.webp`);
}
