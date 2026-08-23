// Сборка списка фото для «Дрейфующей стены» (секция Gallery на лендинге).
//
// Владелец кидает снимки в public/uploads/showcase/ и НИЧЕГО не правит в коде:
// список собирается здесь и уезжает в src/data/galleryPhotos.generated.json.
// Скрипт висит на predev/prebuild в package.json.
//
// Почему не отдаём оригиналы как есть: это кадры с камеры, 4000–6000px и
// 5–8 МБ штука (47 файлов = 245 МБ). На лендинге такое грузить нельзя, да и в
// git такому не место. Поэтому:
//   public/uploads/showcase/      — оригиналы, В GIT НЕ ХОДЯТ (.gitignore),
//                                   живут только на машине владельца;
//   public/uploads/showcase-web/  — сжатые webp (ширина 900, q76 ≈ 100–200 КБ),
//                                   ИМЕННО ОНИ коммитятся и уезжают на прод.
// Пересжатие ленивое: файл трогаем, только если оригинал новее готового webp.
//
// На сервере оригиналов нет — скрипт это видит и молча оставляет уже собранные
// webp и манифест на месте (иначе прод-сборка стёрла бы галерею).
//
// Имя файла = источник правды: {тег}_{номер}__{исходное имя}.jpg
//   staff-stripedtie_02__IMG_9661.jpeg → тег staff-stripedtie, номер 02
// Тег группирует кадры одного человека/сюжета — по нему раскладка на сайте
// разводит похожие фото по разным местам. Всё, что не подходит под маску
// (контакт-листы sheet_1.jpg, копии «— копия»), пропускается.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'public', 'uploads', 'showcase');
const OUT_DIR = path.join(ROOT, 'public', 'uploads', 'showcase-web');
const MANIFEST = path.join(ROOT, 'src', 'data', 'galleryPhotos.generated.json');

const NAME_RE = /^([a-z-]+)_(\d+)__.+\.(jpe?g)$/i;
// Два размера: на стене плитка ≈ 200–420px, поэтому мелким экранам и узким
// колонкам хватает 480px, а 900 остаётся для крупных плиток и retina. Браузер
// выбирает сам по srcset — на первой прокрутке это заметно меньше декодирования.
const SIZES = [
  { width: 900, quality: 76, suffix: '' },
  { width: 480, quality: 74, suffix: '.sm' },
];

async function exists(p) { try { await fs.stat(p); return true; } catch { return false; } }

async function readManifest() {
  try { return JSON.parse(await fs.readFile(MANIFEST, 'utf8')); } catch { return null; }
}

async function main() {
  if (!(await exists(SRC_DIR))) {
    const kept = await readManifest();
    console.log(kept
      ? `[gallery] папки ${path.relative(ROOT, SRC_DIR)} нет — оставляю собранный манифест (${kept.photos.length} фото)`
      : '[gallery] нет ни исходников, ни манифеста — секция галереи не отрендерится');
    if (!kept) {
      await fs.mkdir(path.dirname(MANIFEST), { recursive: true });
      await fs.writeFile(MANIFEST, JSON.stringify({ generatedAt: null, photos: [] }, null, 2));
    }
    return;
  }

  const names = (await fs.readdir(SRC_DIR)).sort();
  const skipped = [];
  const photos = [];
  await fs.mkdir(OUT_DIR, { recursive: true });

  let converted = 0;
  for (const name of names) {
    const m = name.match(NAME_RE);
    if (!m) { skipped.push(name); continue; }

    const [, tag, seq] = m;
    const srcPath = path.join(SRC_DIR, name);
    const outName = `${name.replace(/\.[^.]+$/, '')}.webp`;
    const outPath = path.join(OUT_DIR, outName);

    const srcStat = await fs.stat(srcPath);
    for (const size of SIZES) {
      const file = outPath.replace(/\.webp$/, `${size.suffix}.webp`);
      const outStat = await fs.stat(file).catch(() => null);
      if (!outStat || outStat.mtimeMs < srcStat.mtimeMs) {
        await sharp(srcPath, { failOn: 'none' })
          .rotate() // учесть EXIF-ориентацию: иначе портреты лягут боком
          .resize({ width: size.width, withoutEnlargement: true })
          .webp({ quality: size.quality })
          .toFile(file);
        converted++;
      }
    }

    const meta = await sharp(outPath).metadata();
    photos.push({
      tag: tag.toLowerCase(),
      seq: Number(seq),
      src: `/uploads/showcase-web/${outName}`,
      srcSm: `/uploads/showcase-web/${outName.replace(/\.webp$/, '.sm.webp')}`,
      w: meta.width,
      h: meta.height,
    });
  }

  // Сироты: webp, у которого больше нет оригинала (фото убрали из папки).
  const alive = new Set(photos.flatMap(p => [path.basename(p.src), path.basename(p.srcSm)]));
  for (const f of await fs.readdir(OUT_DIR)) {
    if (f.endsWith('.webp') && !alive.has(f)) {
      await fs.rm(path.join(OUT_DIR, f), { force: true });
      console.log(`[gallery] убрал лишний ${f} — исходника больше нет`);
    }
  }

  photos.sort((a, b) => (a.tag === b.tag ? a.seq - b.seq : a.tag.localeCompare(b.tag)));

  await fs.mkdir(path.dirname(MANIFEST), { recursive: true });
  await fs.writeFile(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), photos }, null, 2) + '\n');

  const tags = new Set(photos.map(p => p.tag));
  console.log(`[gallery] ${photos.length} фото, ${tags.size} тегов; пересжато ${converted}`);
  if (skipped.length) console.warn(`[gallery] пропущено ${skipped.length} файлов (не по маске): ${skipped.join(', ')}`);
}

main().catch((e) => { console.error('[gallery] ошибка:', e.message); process.exit(1); });
