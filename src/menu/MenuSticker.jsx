// Стикеры-эмоции для пузырей навигации по барной карте.
//
// Идея владельца: у каждой категории — свой кот в настроении напитка. Кот
// нарисован линией (как арт-деко орнаменты книги), а не залит: тонкий штрих
// золотом на стекле пузыря, никакой мультяшности. Морда общая, отличаются
// глаза/рот/бровь (эмоция) и предмет в лапе (бокал, кружка, чашка).
//
// Анимация — ТОЛЬКО на наведении (класс .is-hot ставит пузырь). Правило
// проекта: ничего бесконечного на постоянно видимом элементе; здесь движение
// живёт лишь пока курсор на пузыре, и полностью выключено при
// prefers-reduced-motion (см. menubook.css). Всё движение — transform/opacity.

import { norm } from './subgroups.js';
import './sticker.css';

/* ── Предметы (то, что кот держит) ───────────────────────────────────────── */

const PROPS = {
  // Коктейльная купе: чаша, ножка, подставка, вишенка на шпажке.
  coupe: (
    <g>
      <path d="M40 40 L56 40 L48 49 Z" />
      <path d="M48 49 L48 55 M43 55 L53 55" />
      <path d="M52 34 L50 40" />
      <circle cx="52.5" cy="33" r="1.6" />
    </g>
  ),
  // Бокал для вина: вытянутая чаша.
  wine: (
    <g>
      <path d="M41 37 C41 45 44 48 48 48 C52 48 55 45 55 37 Z" />
      <path d="M48 48 L48 55 M43 55 L53 55" />
    </g>
  ),
  // Тумблер: стакан с толстым дном, кубик льда, линия налива.
  tumbler: (
    <g>
      <path d="M41 39 L42.5 55 L53.5 55 L55 39 Z" />
      <path d="M41.6 45 L54.4 45" />
      <path d="M45 47 L48 47 L48 50 L45 50 Z" />
    </g>
  ),
  // Стопка.
  shot: (
    <g>
      <path d="M43 42 L44.5 55 L51.5 55 L53 42 Z" />
      <path d="M43.5 47 L52.5 47" />
    </g>
  ),
  // Пивная кружка с ручкой и шапкой пены.
  mug: (
    <g>
      <path d="M41 41 L42 55 L53 55 L54 41 Z" />
      <path d="M54 44 C58 44 58 50 54 50" />
      <path d="M40.4 41 C43 38.6 46 41.4 48 39.6 C50 41.4 53 38.6 54.6 41" />
    </g>
  ),
  // Чашка на блюдце (кофе/чай).
  cup: (
    <g>
      <path d="M41 42 C41 51 44 54 47.5 54 C51 54 54 51 54 42 Z" />
      <path d="M54 45 C57.5 45 57.5 50 54 50" />
      <path d="M38.5 56.5 L56.5 56.5" />
    </g>
  ),
  // Высокий стакан с соломинкой (лимонады, вода, софт).
  tall: (
    <g>
      <path d="M42 36 L43.5 55 L52.5 55 L54 36 Z" />
      <path d="M42.4 41 L53.6 41" />
      <path d="M50 33 L47 55" />
    </g>
  ),
  // Бутылка-фляга (дистилляты, настойки).
  bottle: (
    <g>
      <path d="M46 33 L46 38 C42.5 40 42 42.5 42 46 L42 55 L54 55 L54 46 C54 42.5 53.5 40 50 38 L50 33 Z" />
      <path d="M45 33 L51 33" />
      <path d="M42.4 47.5 L53.6 47.5" />
    </g>
  ),
};

/* ── Эмоции (глаза, рот, брови) ──────────────────────────────────────────── */

const eyeDot = (cx, cy = 30, r = 2.2) => <circle key={cx} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
const eyeArc = (cx, cy = 30) => <path key={cx} d={`M${cx - 3.4} ${cy + 1.4} C${cx - 1.6} ${cy - 2.2} ${cx + 1.6} ${cy - 2.2} ${cx + 3.4} ${cy + 1.4}`} />;
const eyeLine = (cx, cy = 30) => <path key={cx} d={`M${cx - 3.4} ${cy} L${cx + 3.4} ${cy}`} />;
const eyeSquint = (cx, cy = 30) => <path key={cx} d={`M${cx - 3.4} ${cy - 1.2} C${cx - 1.6} ${cy + 1.6} ${cx + 1.6} ${cy + 1.6} ${cx + 3.4} ${cy - 1.2}`} />;
const eyeWide = (cx, cy = 30) => (
  <g key={cx}>
    <circle cx={cx} cy={cy} r="4.2" />
    <circle cx={cx} cy={cy} r="1.9" fill="currentColor" stroke="none" />
  </g>
);
const eyeStar = (cx, cy = 30) => (
  <g key={cx}>
    <path d={`M${cx} ${cy - 4.2} L${cx + 1.2} ${cy - 1.2} L${cx + 4.2} ${cy} L${cx + 1.2} ${cy + 1.2} L${cx} ${cy + 4.2} L${cx - 1.2} ${cy + 1.2} L${cx - 4.2} ${cy} L${cx - 1.2} ${cy - 1.2} Z`} />
  </g>
);

const MOUTHS = {
  // «ω» — классический кошачий рот.
  omega: <path d="M25 39 C26.6 41.6 29.4 41.6 31 39 C32.6 41.6 35.4 41.6 37 39" />,
  smile: <path d="M25.5 38.4 C28.5 42.6 33.5 42.6 36.5 38.4" />,
  grin: (
    <g>
      <path d="M25 38.2 C28.5 43.4 33.5 43.4 37 38.2 Z" />
      <path d="M27.6 40.4 L29.4 42.8 M34.4 40.4 L32.6 42.8" />
    </g>
  ),
  flat: <path d="M27 40 L35 40" />,
  sour: <path d="M26.5 41.4 C29 38.6 33 38.6 35.5 41.4" />,
  tongue: (
    <g>
      <path d="M25 39 C26.6 41.6 29.4 41.6 31 39 C32.6 41.6 35.4 41.6 37 39" />
      <path d="M29 41.4 C29 45 33 45 33 41.4" />
    </g>
  ),
  yawn: <ellipse cx="31" cy="41" rx="3.6" ry="4.4" />,
};

/**
 * Настроения. eyes — рисовалка глаз, mouth — рот, extra — деталь (монокль,
 * бабочка, пар), fx — что оживает на наведении (см. .cs--<fx> в menubook.css).
 */
const MOODS = {
  delight:  { eyes: eyeStar,   mouth: 'grin',   fx: 'sparkle' },  // коктейли
  languid:  { eyes: eyeSquint, mouth: 'smile',  fx: 'sway' },     // вермуты
  wink:     { eyes: 'wink',    mouth: 'grin',   fx: 'wink' },     // ром
  fiery:    { eyes: eyeDot,    mouth: 'tongue', fx: 'flame' },    // текила
  noble:    { eyes: 'monocle', mouth: 'flat',   fx: 'brow' },     // виски
  fresh:    { eyes: eyeArc,    mouth: 'smile',  fx: 'sparkle' },  // джин
  posh:     { eyes: eyeSquint, mouth: 'omega',  fx: 'sway' },     // коньяк
  curious:  { eyes: 'curious', mouth: 'omega',  fx: 'ears' },     // дистилляты
  stoic:    { eyes: eyeLine,   mouth: 'flat',   fx: 'blink' },    // водка
  sour:     { eyes: eyeSquint, mouth: 'sour',   fx: 'shiver' },   // биттеры
  sweet:    { eyes: eyeArc,    mouth: 'smile',  fx: 'sparkle' },  // ликёры
  chill:    { eyes: eyeSquint, mouth: 'grin',   fx: 'sway' },     // пиво
  bright:   { eyes: eyeDot,    mouth: 'smile',  fx: 'fizz' },     // лимонады
  awake:    { eyes: eyeWide,   mouth: 'omega',  fx: 'steam' },    // кофе
  serene:   { eyes: eyeArc,    mouth: 'omega',  fx: 'steam' },    // крафтовый чай
  sleepy:   { eyes: eyeArc,    mouth: 'yawn',   fx: 'steam' },    // чай
  calm:     { eyes: eyeLine,   mouth: 'omega',  fx: 'blink' },    // вода
  friendly: { eyes: eyeDot,    mouth: 'smile',  fx: 'ears' },     // софт
};

/* ── Соответствие «раздел карты → стикер» ────────────────────────────────── */

// Ключ — нормализованное название раздела из карты владельца. Незнакомый
// раздел ловится по ключевому слову (RULES), а совсем незнакомый получает
// нейтрального кота: новая категория в админке не ломает навигацию.
const BY_TITLE = {
  'коктейльная карта':        { prop: 'coupe',   mood: 'delight' },
  'крепленые вина и вермуты': { prop: 'wine',    mood: 'languid' },
  'ром и кашаса':             { prop: 'tumbler', mood: 'wink' },
  'текила и мескаль':         { prop: 'shot',    mood: 'fiery' },
  'виски':                    { prop: 'tumbler', mood: 'noble' },
  'джин':                     { prop: 'tall',    mood: 'fresh' },
  'коньяк':                   { prop: 'wine',    mood: 'posh' },
  'дистилляты':               { prop: 'bottle',  mood: 'curious' },
  'водка':                    { prop: 'shot',    mood: 'stoic' },
  'биттеры и аперитивы':      { prop: 'coupe',   mood: 'sour' },
  'ликеры и настойки':        { prop: 'bottle',  mood: 'sweet' },
  'пиво и сидр':              { prop: 'mug',     mood: 'chill' },
  'лимонады':                 { prop: 'tall',    mood: 'bright' },
  'кофе':                     { prop: 'cup',     mood: 'awake' },
  'крафтовый чай':            { prop: 'cup',     mood: 'serene' },
  'чай':                      { prop: 'cup',     mood: 'sleepy' },
  'вода':                     { prop: 'tall',    mood: 'calm' },
  'софт напитки':             { prop: 'tall',    mood: 'friendly' },
};

const RULES = [
  [/виск|скотч|бурбон|шотланд|ирланд|америк/, { prop: 'tumbler', mood: 'noble' }],
  [/коктейл/,                                  { prop: 'coupe',   mood: 'delight' }],
  [/вин|вермут|шампан|игрист|портвейн|херес/,  { prop: 'wine',    mood: 'languid' }],
  [/ром|кашас/,                                { prop: 'tumbler', mood: 'wink' }],
  [/текил|мескал/,                             { prop: 'shot',    mood: 'fiery' }],
  [/джин/,                                     { prop: 'tall',    mood: 'fresh' }],
  [/коньяк|бренди|арманьяк/,                   { prop: 'wine',    mood: 'posh' }],
  [/водк/,                                     { prop: 'shot',    mood: 'stoic' }],
  [/биттер|аперитив/,                          { prop: 'coupe',   mood: 'sour' }],
  [/ликер|настойк|дистил|самогон|граппа/,      { prop: 'bottle',  mood: 'sweet' }],
  [/пив|сидр|эль/,                             { prop: 'mug',     mood: 'chill' }],
  [/кофе|эспрессо|капучино/,                   { prop: 'cup',     mood: 'awake' }],
  [/чай|матч/,                                 { prop: 'cup',     mood: 'sleepy' }],
  [/лимонад|морс|сок|софт|безалко/,            { prop: 'tall',    mood: 'bright' }],
  [/вод[аы]|минерал/,                          { prop: 'tall',    mood: 'calm' }],
  [/закус|еда|кухн|снек/,                      { prop: 'cup',     mood: 'friendly' }],
];

const DEFAULT_STICKER = { prop: 'tumbler', mood: 'friendly' };

/** Какой стикер положен разделу карты. */
export function stickerFor(title) {
  const t = norm(title);
  if (BY_TITLE[t]) return BY_TITLE[t];
  for (const [re, s] of RULES) if (re.test(t)) return s;
  return DEFAULT_STICKER;
}

/* ── Сама морда ──────────────────────────────────────────────────────────── */

function Eyes({ mood }) {
  const kind = MOODS[mood]?.eyes || eyeDot;
  if (kind === 'wink') {
    // Один глаз открыт, второй подмигивает: закрытая дуга поверх точки —
    // на наведении точка гаснет, дуга проявляется (см. .cs--wink).
    return (
      <g className="cs__eyes">
        {eyeDot(24)}
        <g className="cs__wink-open">{eyeDot(38)}</g>
        <g className="cs__wink-shut">{eyeSquint(38)}</g>
      </g>
    );
  }
  if (kind === 'monocle') {
    return (
      <g className="cs__eyes">
        {eyeDot(24)}
        {eyeDot(38)}
        <g className="cs__monocle">
          <circle cx="38" cy="30" r="6.4" />
          <path d="M38 36.4 L40.5 44" />
        </g>
        <path className="cs__brow" d="M20.5 24.6 C22.4 22.8 25.8 22.8 27.6 24.4" />
      </g>
    );
  }
  if (kind === 'curious') {
    // Разного размера глаза — «а что это у вас тут».
    return <g className="cs__eyes">{eyeDot(24, 30, 1.7)}{eyeWide(38)}</g>;
  }
  return <g className="cs__eyes">{kind(24)}{kind(38)}</g>;
}

function Fx({ fx }) {
  if (fx === 'steam') {
    return (
      <g className="cs__fx">
        <path className="cs__steam cs__steam--1" d="M45 30 C42.6 27 47.4 25 45 22" />
        <path className="cs__steam cs__steam--2" d="M51 31 C48.6 28 53.4 26 51 23" />
      </g>
    );
  }
  if (fx === 'sparkle') {
    return (
      <g className="cs__fx">
        <path className="cs__spark cs__spark--1" d="M54 24 L55 27 L58 28 L55 29 L54 32 L53 29 L50 28 L53 27 Z" />
        <path className="cs__spark cs__spark--2" d="M17 20 L17.8 22.2 L20 23 L17.8 23.8 L17 26 L16.2 23.8 L14 23 L16.2 22.2 Z" />
      </g>
    );
  }
  if (fx === 'flame') {
    return (
      <g className="cs__fx">
        <path className="cs__flame" d="M48 30 C45 26.5 50 25 48 20 C53 24 52.5 27.5 48 30 Z" />
      </g>
    );
  }
  if (fx === 'fizz') {
    return (
      <g className="cs__fx">
        <circle className="cs__bub cs__bub--1" cx="46" cy="32" r="1.5" />
        <circle className="cs__bub cs__bub--2" cx="51" cy="30" r="1.1" />
        <circle className="cs__bub cs__bub--3" cx="48.5" cy="27" r="1.8" />
      </g>
    );
  }
  return null;
}

/**
 * Стикер категории.
 * @param title раздел карты (по нему подбирается кот)
 * @param size  сторона svg в пикселях
 */
export default function MenuSticker({ title, size = 44 }) {
  const { prop, mood } = stickerFor(title);
  const m = MOODS[mood] || MOODS.friendly;

  return (
    <svg
      className={`cs cs--${m.fx}`}
      viewBox="0 0 64 64" width={size} height={size}
      aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round"
    >
      {/* Уши — отдельными группами: на наведении дёргаются по очереди. */}
      <g className="cs__ear cs__ear--l"><path d="M14.6 24.6 L13 12.6 L23.8 18.6" /></g>
      <g className="cs__ear cs__ear--r"><path d="M47.4 24.6 L49 12.6 L38.2 18.6" /></g>

      {/* Голова */}
      <path className="cs__head" d="M31 17.4 C43.4 17.4 49.6 24.6 49.6 33.4 C49.6 42.6 42 48.6 31 48.6 C20 48.6 12.4 42.6 12.4 33.4 C12.4 24.6 18.6 17.4 31 17.4 Z" />

      <Eyes mood={mood} />

      {/* Нос и рот */}
      <g className="cs__mouth">
        <path d="M29.4 35.6 L32.6 35.6 L31 37.6 Z" fill="currentColor" stroke="none" />
        {MOUTHS[m.mouth] || MOUTHS.omega}
      </g>

      {/* Усы */}
      <g className="cs__whisk">
        <path d="M13.6 33.4 L4.6 31.4 M13.6 36.4 L5 37.6" />
        <path d="M48.4 33.4 L54 32.2" />
      </g>

      {/* Предмет в лапе. Смещение — на внешней группе: на .cs__prop висит
          анимация «чокнуться», а она перебивает собственный transform. */}
      <g transform="translate(6.5, 3) scale(0.92)">
        <g className="cs__prop">{PROPS[prop] || PROPS.tumbler}</g>
      </g>

      <Fx fx={m.fx} />
    </svg>
  );
}
