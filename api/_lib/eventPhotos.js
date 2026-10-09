import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

// Фото событий: файлы на диске (персистентная папка ВНЕ релизов — деплой
// атомарный, всё в dist/ пропадает при флипе симлинка; см. HANDOFF §B).
// sharp жмёт в webp два размера: <n>.webp (~1600px) и <n>.thumb.webp (~480px).
// В БД (events.image_urls) пишем абсолютные веб-пути /uploads/events/<id>/<n>.webp —
// их отдаёт nginx (^~ /uploads/events/ alias) или express.static-фолбэк server.js.
//
// Ошибки удаления одного фото показываются редактором для повторной очистки.
// При удалении события сохраняем пары, на которые ссылаются другие события.

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

/** Удалить одно принадлежащее событию фото; ошибки диска не скрываем. */
export async function deleteEventPhoto(eventId, url) {
  const match = typeof url === 'string' && url.match(/^\/uploads\/events\/([a-zA-Z0-9_-]+)\/(0|[1-9]\d*)\.webp$/);
  if (!match || match[1] !== String(eventId) || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error('Некорректная ссылка на фото события');
  }
  const n = Number(match[2]);
  const dir = eventDir(eventId);
  await fs.rm(path.join(dir, `${n}.webp`), { force: true });
  await fs.rm(path.join(dir, `${n}.thumb.webp`), { force: true });
}

/** Удалить непривязанные пары; retainedUrls проверены вызывающим кодом в БД. */
export async function deleteEventPhotos(eventId, retainedUrls) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(eventId)) || !(retainedUrls instanceof Set)) {
    throw new Error('Некорректная проверка ссылок фото события');
  }
  const dir = eventDir(eventId);
  let files;
  try { files = await fs.readdir(dir); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const indices = new Set(files.map(f => f.match(/^(0|[1-9]\d*)(?:\.thumb)?\.webp$/)?.[1]).filter(Boolean));
  for (const index of indices) {
    const url = `${URL_BASE}/${eventId}/${index}.webp`;
    if (!retainedUrls.has(url)) await deleteEventPhoto(eventId, url);
  }
  // Never recursively remove a directory: retained pairs and unknown files survive.
  try { await fs.rmdir(dir); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
}

/** Абсолютный путь основного файла фото на диске (для отправки в Telegram через InputFile). */
export function photoFilePath(url) {
  const m = String(url).match(/\/uploads\/events\/([^/]+)\/(\d+)\.webp$/);
  if (!m) return null;
  return path.join(eventDir(m[1]), `${m[2]}.webp`);
}
