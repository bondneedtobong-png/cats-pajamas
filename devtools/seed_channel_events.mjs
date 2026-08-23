// Заливка прошлых событий из канала в БД: фото прогоняются через штатный
// eventPhotos.js (webp + миниатюра в персистентную папку), запись создаётся
// штатным createEvent — то есть ровно тем же путём, что и админка.
//
// Манифест: devtools/seed/channel-events.json (тексты постов, даты, ссылки).
// Фото рядом с манифестом: devtools/seed/photos/<имя>.jpg.
//
// Запуск локально (песочница):
//   PORT=3020 node devtools/sandbox.mjs           # в соседнем окне
//   node devtools/seed_channel_events.mjs --sandbox
//
// Запуск на проде (с сервера, env берётся из .env проекта):
//   ssh cats-pajamas 'cd /opt/cats-pajamas-club && node devtools/seed_channel_events.mjs'
//
// Идемпотентность: событие с таким id уже есть → пропускаем (повторный
// прогон ничего не дублирует). --force перезаписывает описание/дату/ссылку.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = process.argv.includes('--sandbox');
const FORCE = process.argv.includes('--force');

if (SANDBOX) {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'sandbox';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sandbox';
  process.env.EVENT_UPLOADS_DIR = process.env.EVENT_UPLOADS_DIR || path.join(HERE, '..', 'uploads-runtime', 'events');
} else {
  await import('dotenv/config');
}

const { saveEventPhoto } = await import('../api/_lib/eventPhotos.js');
const { createEvent, updateEvent, getEventById } = await import('../api/_lib/events.js');

const manifestPath = path.join(HERE, 'seed', 'channel-events.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const photosDir = path.join(HERE, 'seed', 'photos');

let created = 0, skipped = 0, updated = 0;

for (const ev of manifest.events) {
  const existing = await getEventById(ev.id);
  if (existing && !FORCE) {
    console.log(`= ${ev.id} «${ev.title}» — уже есть, пропускаю`);
    skipped++;
    continue;
  }

  const urls = [];
  for (const name of ev.photos || []) {
    const buf = await fs.readFile(path.join(photosDir, name));
    const saved = await saveEventPhoto(ev.id, buf);
    urls.push(saved.url);
  }

  const data = {
    id: ev.id,
    title: ev.title,
    date: ev.date,
    time: ev.time || '',
    description: ev.description || '',
    imageUrls: urls,
    channelPostUrl: ev.channelPostUrl || '',
    active: true,
  };

  if (existing) {
    await updateEvent(ev.id, data);
    console.log(`~ ${ev.id} «${ev.title}» — обновлено (${urls.length} фото)`);
    updated++;
  } else {
    await createEvent(data);
    console.log(`+ ${ev.id} «${ev.title}» — создано (${urls.length} фото)`);
    created++;
  }
}

console.log(`\nИтого: создано ${created}, обновлено ${updated}, пропущено ${skipped}.`);
