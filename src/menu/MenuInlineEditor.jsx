import { useState, Fragment } from 'react';
import BarMenuService from './BarMenuService.js';
import { useFeedback } from '../ui/FeedbackProvider.jsx';
import EditableText from './EditableText.jsx';
import { Fan, CornerFan } from './MenuCard.jsx';

// Инлайн-редактор барной карты для админов. НЕ модалка и НЕ отдельная страница:
// рендерит ту же раскладку «Напитки» (.mbk — кнопки слева, карточка в центре,
// история справа), но её тексты/цены/объёмы правятся прямо на месте (см.
// EditableText — шрифты остаются «как на сайте»). Слева можно добавлять и удалять
// группы/категории, в карточке — позиции. Правим единым листом (в один столбец
// удобнее, чем в два узких): на сайте длинная категория сама раскладывается на
// два листа и растёт вниз (это делает просмотр в Menu.jsx, правка не мешает). На
// «Сохранить» вся карта уходит одним блобом в POST /api/bar-menu (сервер
// санитайзит и проверяет роль).

let _uid = 1;
const key = () => `k${_uid++}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const newItem = () => ({ _k: key(), name: '', origin: '', volume: '', price: '' });
const newCat = () => ({ _k: key(), title: 'Новая категория', unit: '', story: '', quote: { text: '', author: '' }, items: [newItem()] });
const hasContent = (c) => c.items.some((it) => (it.name || '').trim());

// {menu, stories} с сервера → рабочая модель: у каждой категории свои поля
// story/quote/items с уникальными _k (стабильные ключи при перестановках).
function toDraft(initial) {
  const stories = initial.stories || {};
  return (initial.menu || []).map((g) => ({
    _k: key(),
    id: g.id,
    title: g.title || '',
    categories: (g.categories || []).map((c) => ({
      _k: key(),
      title: c.title || '',
      unit: c.unit || '',
      story: stories[c.title] || '',
      quote: { text: c.quote?.text || '', author: c.quote?.author || '' },
      items: (c.items || []).map((it) => ({
        _k: key(), name: it.name || '', origin: it.origin || '', volume: it.volume || '', price: it.price || '',
      })),
    })),
  }));
}

// Рабочая модель → payload {menu, stories}. Пустые quote/story/origin/volume не
// пишем; окончательную чистку (обрезка, отсев безымянных позиций) делает сервер.
function fromDraft(draft) {
  const menu = draft.map((g) => ({
    id: g.id,
    title: g.title,
    categories: g.categories.map((c) => ({
      title: c.title,
      ...(c.unit ? { unit: c.unit } : {}),
      ...(c.quote?.text ? { quote: { text: c.quote.text, author: c.quote.author } } : {}),
      items: c.items.map((it) => ({
        name: it.name,
        ...(it.origin ? { origin: it.origin } : {}),
        ...(it.volume ? { volume: it.volume } : {}),
        price: it.price,
      })),
    })),
  }));
  const stories = {};
  draft.forEach((g) => g.categories.forEach((c) => {
    if (c.story && c.story.trim()) stories[(c.title || '').trim()] = c.story.trim();
  }));
  return { menu, stories };
}

export default function MenuInlineEditor({ initial, onCancel, onSaved }) {
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [sel, setSel] = useState({ g: 0, c: 0 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const { toast, confirm } = useFeedback();

  const mutate = (fn) => setDraft((prev) => { const next = clone(prev); fn(next); return next; });
  const clampSel = (next) => {
    const g = Math.max(0, Math.min(sel.g, next.length - 1));
    const c = Math.max(0, Math.min(sel.c, (next[g]?.categories.length || 1) - 1));
    setSel({ g, c });
  };

  const cat = draft[sel.g]?.categories[sel.c] || null;

  // ─── группы ────────────────────────────────────────────────────────────────
  const addGroup = () => mutate((d) => {
    d.push({ _k: key(), id: 'group', title: 'Новая группа', categories: [newCat()] });
    setSel({ g: d.length - 1, c: 0 });
  });
  const renameGroup = (gi, v) => mutate((d) => { d[gi].title = v; });
  const moveGroup = (gi, dir) => mutate((d) => {
    const j = gi + dir; if (j < 0 || j >= d.length) return;
    [d[gi], d[j]] = [d[j], d[gi]];
    if (sel.g === gi) setSel((s) => ({ ...s, g: j }));
    else if (sel.g === j) setSel((s) => ({ ...s, g: gi }));
  });
  const delGroup = async (gi) => {
    if (draft.length <= 1) return;
    const g = draft[gi];
    if (g.categories.some(hasContent)) {
      const okc = await confirm({
        title: 'Удалить группу?',
        message: `«${g.title || 'без названия'}» и все её категории (${g.categories.length}) исчезнут с карты. Пока не нажали «Сохранить», всё вернёт «Отмена».`,
        confirmLabel: 'Удалить', danger: true,
      });
      if (!okc) return;
    }
    mutate((d) => { d.splice(gi, 1); clampSel(d); });
  };

  // ─── категории ─────────────────────────────────────────────────────────────
  const addCat = (gi) => mutate((d) => {
    d[gi].categories.push(newCat());
    setSel({ g: gi, c: d[gi].categories.length - 1 });
  });
  const moveCat = (gi, ci, dir) => mutate((d) => {
    const arr = d[gi].categories; const j = ci + dir; if (j < 0 || j >= arr.length) return;
    [arr[ci], arr[j]] = [arr[j], arr[ci]];
    if (sel.g === gi && sel.c === ci) setSel({ g: gi, c: j });
    else if (sel.g === gi && sel.c === j) setSel({ g: gi, c: ci });
  });
  const delCat = async (gi, ci) => {
    if (draft.length <= 1 && draft[gi].categories.length <= 1) return; // не оставлять пустую карту
    const c = draft[gi].categories[ci];
    if (hasContent(c)) {
      const okc = await confirm({
        title: 'Удалить категорию?',
        message: `«${c.title || 'без названия'}» и её позиции (${c.items.length}) будут удалены. Пока не нажали «Сохранить», всё вернёт «Отмена».`,
        confirmLabel: 'Удалить', danger: true,
      });
      if (!okc) return;
    }
    mutate((d) => {
      d[gi].categories.splice(ci, 1);
      if (!d[gi].categories.length) d.splice(gi, 1);
      clampSel(d);
    });
  };
  const patchCat = (field, v) => mutate((d) => { d[sel.g].categories[sel.c][field] = v; });
  const patchQuote = (field, v) => mutate((d) => { d[sel.g].categories[sel.c].quote[field] = v; });

  // ─── позиции ───────────────────────────────────────────────────────────────
  const addItem = () => mutate((d) => { d[sel.g].categories[sel.c].items.push(newItem()); });
  const patchItem = (ii, field, v) => mutate((d) => { d[sel.g].categories[sel.c].items[ii][field] = v; });
  const moveItem = (ii, dir) => mutate((d) => {
    const arr = d[sel.g].categories[sel.c].items; const j = ii + dir; if (j < 0 || j >= arr.length) return;
    [arr[ii], arr[j]] = [arr[j], arr[ii]];
  });
  const delItem = (ii) => mutate((d) => { d[sel.g].categories[sel.c].items.splice(ii, 1); });

  const h = { patchCat, patchQuote, addItem, patchItem, moveItem, delItem };

  async function handleSave() {
    setErr(''); setSaving(true);
    try {
      const saved = await BarMenuService.save(fromDraft(draft));
      toast.success('Барная карта сохранена');
      onSaved(saved);
    } catch (ex) {
      setErr(ex.message || 'Не удалось сохранить');
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mbk-edit-bar">
        <button type="button" className="mbk-edit-cancel" onClick={onCancel} disabled={saving}>Отмена</button>
        <button type="button" className="mbk-edit-save" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохраняем…' : '✓ Сохранить карту'}
        </button>
        <span className="mbk-edit-bar__note">
          Изменения появятся на сайте сразу. В поиске (карта&nbsp;/menu) — после следующего деплоя.
        </span>
        {err && <span className="mbk-edit-bar__err">{err}</span>}
      </div>

      <div className="mbk mbk--edit">
        {/* Слева: группы и категории с добавлением/удалением/переносом */}
        <nav className="mbk__nav mbk__nav--edit" aria-label="Разделы меню — редактирование">
          {draft.map((group, gi) => (
            <Fragment key={group._k}>
              <div className="mbk-edit-grouphead">
                <EditableText
                  tag="span" className="mbk__nav-label mbk-edit-grouplabel"
                  value={group.title} onChange={(v) => renameGroup(gi, v)} placeholder="Название группы"
                />
                <button className="mbk-mini" onClick={() => moveGroup(gi, -1)} disabled={gi === 0} title="Выше" aria-label="Группу выше">↑</button>
                <button className="mbk-mini" onClick={() => moveGroup(gi, 1)} disabled={gi === draft.length - 1} title="Ниже" aria-label="Группу ниже">↓</button>
                <button className="mbk-mini mbk-mini--danger" onClick={() => delGroup(gi)} disabled={draft.length <= 1} title="Удалить группу" aria-label="Удалить группу">✕</button>
              </div>
              {group.categories.map((c, ci) => {
                const active = sel.g === gi && sel.c === ci;
                return (
                  <div className={`mbk-edit-catrow${active ? ' mbk-edit-catrow--active' : ''}`} key={c._k}>
                    <button
                      type="button"
                      className={`mbk__nav-btn${active ? ' mbk__nav-btn--active' : ''}`}
                      onClick={() => setSel({ g: gi, c: ci })}
                    >
                      {c.title || 'Без названия'}
                    </button>
                    <button className="mbk-mini" onClick={() => moveCat(gi, ci, -1)} disabled={ci === 0} title="Выше" aria-label="Категорию выше">↑</button>
                    <button className="mbk-mini" onClick={() => moveCat(gi, ci, 1)} disabled={ci === group.categories.length - 1} title="Ниже" aria-label="Категорию ниже">↓</button>
                    <button className="mbk-mini mbk-mini--danger" onClick={() => delCat(gi, ci)} title="Удалить категорию" aria-label="Удалить категорию">✕</button>
                  </div>
                );
              })}
              <button type="button" className="mbk-edit-add mbk-edit-add--sub" onClick={() => addCat(gi)}>+ категория</button>
            </Fragment>
          ))}
          <button type="button" className="mbk-edit-add" onClick={addGroup}>+ группа</button>
        </nav>

        {/* Центр: карточка выбранной категории единым листом (в один столбец
            править удобнее). На сайте длинная категория сама делится на два
            листа — это делает просмотр, здесь не дублируем. */}
        <div className="mbk__spread mbk__spread--single mbk__spread--edit">
          {!cat ? (
            <div className="mbk-edit-emptyspread">Выберите или добавьте категорию слева</div>
          ) : (
            <EditCard cat={cat} items={cat.items} offset={0} total={cat.items.length} showHead showQuote isLast h={h} />
          )}
        </div>

        {/* Справа: история раздела (правится прямо в панели) */}
        <aside className="mbk__story mbk__story--edit">
          <span className="mbk__story-label">О разделе</span>
          <h3 className="mbk__story-title">{cat?.title || 'Новая категория'}</h3>
          {cat && (
            <EditableText
              tag="p" className="mbk__story-text"
              value={cat.story} onChange={(v) => patchCat('story', v)}
              placeholder="Короткая история раздела — 2–3 предложения для правой панели…"
            />
          )}
        </aside>
      </div>
    </>
  );
}

// Редактируемый лист бумажного меню: та же разметка bmn-*, что и в CategoryCard,
// но тексты — EditableText, у каждой позиции ряд управления (вверх/вниз/удалить),
// снизу последнего листа — «+ позиция». offset нужен, чтобы правки на «втором
// листе» разворота попадали в правильный индекс общего массива позиций.
function EditCard({ cat, items, offset, total, showHead, showQuote, isLast, h }) {
  return (
    <article className="bmn-card bmn-card--edit">
      <div className="bmn-card__inner">
        <span className="bmn-corner bmn-corner--tl"><CornerFan /></span>
        <span className="bmn-corner bmn-corner--tr"><CornerFan /></span>
        <span className="bmn-corner bmn-corner--bl"><CornerFan /></span>
        <span className="bmn-corner bmn-corner--br"><CornerFan /></span>
        <span className="bmn-card__fan bmn-card__fan--top"><Fan flip /></span>
        <span className="bmn-card__fan bmn-card__fan--bottom"><Fan /></span>

        {showHead && (
          <EditableText
            tag="h3" className="bmn-card__title"
            value={cat.title} onChange={(v) => h.patchCat('title', v)} placeholder="Название категории"
          />
        )}
        {showHead && (
          <EditableText
            tag="p" className="bmn-card__unit"
            value={cat.unit} onChange={(v) => h.patchCat('unit', v)} placeholder="объём по умолчанию (напр. 50 мл)"
          />
        )}

        <ul className="bmn-card__list">
          {items.map((item, i) => {
            const gi = offset + i;
            return (
              <li className="bmn-item bmn-item--edit" key={item._k}>
                <div className="bmn-item__main">
                  <EditableText tag="span" className="bmn-item__name" value={item.name} onChange={(v) => h.patchItem(gi, 'name', v)} placeholder="Название позиции" />
                  <EditableText tag="span" className="bmn-item__origin" value={item.origin} onChange={(v) => h.patchItem(gi, 'origin', v)} placeholder="состав / происхождение (необязательно)" />
                  <span className="bmn-item__line">
                    <EditableText tag="span" className="bmn-item__vol" value={item.volume} onChange={(v) => h.patchItem(gi, 'volume', v)} placeholder={cat.unit || 'объём'} />
                    <span className="bmn-item__leader" aria-hidden="true" />
                    <EditableText tag="span" className="bmn-item__price" value={item.price} onChange={(v) => h.patchItem(gi, 'price', v)} placeholder="цена" />
                  </span>
                </div>
                <div className="bmn-item__ctrls">
                  <button className="mbk-mini" onClick={() => h.moveItem(gi, -1)} disabled={gi === 0} title="Выше" aria-label="Позицию выше">↑</button>
                  <button className="mbk-mini" onClick={() => h.moveItem(gi, 1)} disabled={gi === total - 1} title="Ниже" aria-label="Позицию ниже">↓</button>
                  <button className="mbk-mini mbk-mini--danger" onClick={() => h.delItem(gi)} title="Удалить позицию" aria-label="Удалить позицию">✕</button>
                </div>
              </li>
            );
          })}
        </ul>

        {isLast && (
          <button type="button" className="bmn-edit-additem" onClick={h.addItem}>+ позиция</button>
        )}

        {showQuote && (
          <figure className="bmn-quote">
            <EditableText
              tag="blockquote" className="bmn-quote__text bmn-quote__text--edit"
              value={cat.quote.text} onChange={(v) => h.patchQuote('text', v)}
              placeholder="цитата-афоризм (без кавычек, необязательно)"
            />
            <EditableText
              tag="figcaption" className="bmn-quote__sign"
              value={cat.quote.author} onChange={(v) => h.patchQuote('author', v)}
              placeholder="— подпись"
            />
          </figure>
        )}
      </div>
    </article>
  );
}
