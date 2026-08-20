// Минимальный читатель .xlsx без зависимостей: распаковка zip штатным
// DecompressionStream (есть и в браузере, и в Node 18+) + разбор
// SpreadsheetML регулярками. Полноценный парсер XML тут не нужен: файлы
// Excel машинно-сгенерированы, нам нужны только строки, стили ячеек и
// значения. Живёт отдельно от excelImport.js, чтобы «как читать книгу
// Excel» не мешалось с «как из неё собрать барную карту».

const td = new TextDecoder('utf-8');

/* ── ZIP ───────────────────────────────────────────────────────────────── */

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Распаковывает zip-архив в Map<имя файла, Uint8Array>.
 * Поддерживает только методы 0 (store) и 8 (deflate) — этого достаточно для
 * любого .xlsx, сохранённого Excel/LibreOffice/Google Sheets.
 */
export async function unzip(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // End of central directory ищем с конца (в хвосте может быть комментарий).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Файл не похож на .xlsx (не найден архив ZIP)');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error('ZIP64 не поддерживается — пересохраните файл из Excel');

  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method   = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen  = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen   = dv.getUint16(p + 32, true);
    const localAt  = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;

    // Размеры полей в локальном заголовке свои — читаем их, а не из центрального.
    const lNameLen  = dv.getUint16(localAt + 26, true);
    const lExtraLen = dv.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataAt, dataAt + compSize);
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return out;
}

/* ── XML ───────────────────────────────────────────────────────────────── */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10));
  return ENT[e.toLowerCase()] ?? m;
});

const textOf = (xml) => {
  let s = '';
  for (const m of xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += decode(m[1]);
  return s;
};

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : '';
};

/* ── Книга ─────────────────────────────────────────────────────────────── */

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/**
 * Вес шрифта ячейки: [размер, жирность]. По нему excelImport определяет
 * уровень заголовка (название листа крупнее группы, группа — крупнее
 * категории), не завися от конкретного оформления файла.
 */
function fontWeights(stylesXml) {
  if (!stylesXml) return [];
  const fonts = [...(stylesXml.match(/<fonts[\s\S]*?<\/fonts>/) || [''])[0]
    .matchAll(/<font>([\s\S]*?)<\/font>/g)].map((m) => ({
      size: Number(attr(m[1].match(/<sz[^>]*\/?>/)?.[0] || '', 'val')) || 11,
      bold: /<b\s*\/?>/.test(m[1]),
    }));
  const xfsBlock = (stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  return [...xfsBlock.matchAll(/<xf[^>]*>/g)].map((m) => {
    const f = fonts[Number(attr(m[0], 'fontId')) || 0] || { size: 11, bold: false };
    return f.size + (f.bold ? 2 : 0);
  });
}

function parseSheet(xml, strings, weights) {
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    let weight = 0;
    for (const cm of rm[2].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = (ref.match(/^[A-Z]+/) || [''])[0];
      const type = attr(cm[1], 't');
      const body = cm[2] || '';
      let val;
      if (type === 's') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? strings[Number(v[1])] ?? '' : '';
      } else if (type === 'inlineStr') {
        val = textOf(body);
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? decode(v[1]) : '';
      }
      // Пробелы НЕ схлопываем: в колонке названий двойной пробел — это
      // разделитель «название ⟷ страна/состав» (см. excelImport.js).
      val = String(val).replace(/\u00a0/g, ' ').trim();
      if (!val) continue;
      cells[col] = val;
      const w = weights[Number(attr(cm[1], 's')) || 0] || 0;
      if (w > weight) weight = w;
    }
    if (Object.keys(cells).length) rows.push({ r: Number(rm[1]), cells, weight });
  }
  return rows;
}

/**
 * Читает .xlsx (ArrayBuffer) → [{ name, rows }], где rows —
 * [{ r: номер строки, cells: { A: 'текст', ... }, weight: вес шрифта }].
 * Пустые строки и ячейки отброшены; порядок листов — как в книге.
 */
export async function readWorkbook(arrayBuffer) {
  const files = await unzip(arrayBuffer);
  const text = (name) => (files.has(name) ? td.decode(files.get(name)) : '');

  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('Это не книга Excel: внутри нет xl/workbook.xml');

  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship[^>]*>/g)]
      .map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target').replace(/^\/?(xl\/)?/, '')]),
  );

  const strings = sharedStrings(text('xl/sharedStrings.xml'));
  const weights = fontWeights(text('xl/styles.xml'));

  const sheets = [];
  for (const m of wb.matchAll(/<sheet[^>]*>/g)) {
    const target = rels.get(attr(m[0], 'r:id'));
    const xml = target ? text(`xl/${target}`) : '';
    if (!xml) continue;
    sheets.push({ name: decode(attr(m[0], 'name')).trim(), rows: parseSheet(xml, strings, weights) });
  }
  if (!sheets.length) throw new Error('В книге нет листов с данными');
  return sheets;
}
