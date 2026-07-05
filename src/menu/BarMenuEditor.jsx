import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import BarMenuService from './BarMenuService.js';
import './barmenu-editor.css';

// Редактор барной карты для админов. Открывается из секции «Напитки», но
// портируется в document.body — иначе position:fixed попал бы под transform
// книги (см. CLAUDE.md). Правит рабочую копию карты; на «Сохранить» шлёт всё
// одним блобом в POST /api/bar-menu (сервер санитайзит и проверяет роль).

const clone = (v) => JSON.parse(JSON.stringify(v));

// {menu, stories} с сервера → плоская рабочая модель, где у категории свои
// поля quoteText/quoteAuthor/story (удобно биндить на инпуты).
function toDraft(initial) {
  const stories = initial.stories || {};
  return (initial.menu || []).map((g) => ({
    id: g.id,
    title: g.title || '',
    categories: (g.categories || []).map((c) => ({
      title: c.title || '',
      unit: c.unit || '',
      quoteText: c.quote?.text || '',
      quoteAuthor: c.quote?.author || '',
      story: stories[c.title] || '',
      items: (c.items || []).map((it) => ({
        name: it.name || '', origin: it.origin || '', volume: it.volume || '', price: it.price || '',
      })),
    })),
  }));
}

// Рабочая модель → payload {menu, stories} для сервера.
function fromDraft(draft) {
  const menu = draft.map((g) => ({
    id: g.id,
    title: g.title,
    categories: g.categories.map((c) => ({
      title: c.title,
      ...(c.unit ? { unit: c.unit } : {}),
      ...(c.quoteText ? { quote: { text: c.quoteText, author: c.quoteAuthor } } : {}),
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
    if (c.story && c.story.trim()) stories[c.title.trim()] = c.story.trim();
  }));
  return { menu, stories };
}

export default function BarMenuEditor({ initial, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [sel, setSel] = useState({ g: 0, c: 0 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const overlayRef = useRef(null);

  // Esc закрывает; стрелки не должны листать книгу под модалкой.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const mutate = (fn) => setDraft((prev) => { const next = clone(prev); fn(next); return next; });
  const clampSel = (next) => {
    const g = Math.min(sel.g, next.length - 1);
    const c = Math.min(sel.c, (next[g]?.categories.length || 1) - 1);
    setSel({ g: Math.max(0, g), c: Math.max(0, c) });
  };

  const cat = draft[sel.g]?.categories[sel.c] || null;

  // ─── операции с группами ──────────────────────────────────────────────────
  const addGroup = () => mutate((d) => {
    d.push({ id: 'group', title: 'Новая группа', categories: [{ title: 'Новая категория', unit: '', quoteText: '', quoteAuthor: '', story: '', items: [] }] });
    setSel({ g: d.length - 1, c: 0 });
  });
  const renameGroup = (gi, v) => mutate((d) => { d[gi].title = v; });
  const moveGroup = (gi, dir) => mutate((d) => {
    const j = gi + dir; if (j < 0 || j >= d.length) return;
    [d[gi], d[j]] = [d[j], d[gi]];
    if (sel.g === gi) setSel((s) => ({ ...s, g: j }));
  });
  const delGroup = (gi) => mutate((d) => {
    if (d.length <= 1) return;
    d.splice(gi, 1);
    clampSel(d);
  });

  // ─── операции с категориями ───────────────────────────────────────────────
  const addCat = (gi) => mutate((d) => {
    d[gi].categories.push({ title: 'Новая категория', unit: '', quoteText: '', quoteAuthor: '', story: '', items: [] });
    setSel({ g: gi, c: d[gi].categories.length - 1 });
  });
  const moveCat = (gi, ci, dir) => mutate((d) => {
    const arr = d[gi].categories; const j = ci + dir; if (j < 0 || j >= arr.length) return;
    [arr[ci], arr[j]] = [arr[j], arr[ci]];
    if (sel.g === gi && sel.c === ci) setSel({ g: gi, c: j });
  });
  const delCat = (gi, ci) => mutate((d) => {
    if (d[gi].categories.length <= 1 && d.length <= 1) return; // не оставлять пустую карту
    d[gi].categories.splice(ci, 1);
    if (!d[gi].categories.length) d.splice(gi, 1);
    clampSel(d);
  });
  const patchCat = (field, v) => mutate((d) => { d[sel.g].categories[sel.c][field] = v; });

  // ─── операции с позициями ─────────────────────────────────────────────────
  const addItem = () => mutate((d) => {
    d[sel.g].categories[sel.c].items.push({ name: '', origin: '', volume: '', price: '' });
  });
  const patchItem = (ii, field, v) => mutate((d) => { d[sel.g].categories[sel.c].items[ii][field] = v; });
  const moveItem = (ii, dir) => mutate((d) => {
    const arr = d[sel.g].categories[sel.c].items; const j = ii + dir; if (j < 0 || j >= arr.length) return;
    [arr[ii], arr[j]] = [arr[j], arr[ii]];
  });
  const delItem = (ii) => mutate((d) => { d[sel.g].categories[sel.c].items.splice(ii, 1); });

  async function handleSave() {
    setErr(''); setSaving(true);
    try {
      const saved = await BarMenuService.save(fromDraft(draft));
      onSaved(saved);
    } catch (ex) {
      setErr(ex.message || 'Не удалось сохранить');
      setSaving(false);
    }
  }

  return createPortal(
    <div className="bme-overlay" ref={overlayRef} onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="bme-modal" role="dialog" aria-label="Редактор барной карты">
        <div className="bme-head">
          <span className="bme-head__title">Барная карта — редактор</span>
          <span className="bme-head__spacer" />
          <button className="bme-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="bme-body">
          {/* дерево групп → категорий */}
          <div className="bme-tree">
            {draft.map((g, gi) => (
              <div className="bme-group" key={gi}>
                <div className="bme-group__head">
                  <input
                    className="bme-group__name"
                    value={g.title}
                    onChange={(e) => renameGroup(gi, e.target.value)}
                    aria-label="Название группы"
                  />
                  <button className="bme-mini" onClick={() => moveGroup(gi, -1)} disabled={gi === 0} aria-label="Выше">↑</button>
                  <button className="bme-mini" onClick={() => moveGroup(gi, 1)} disabled={gi === draft.length - 1} aria-label="Ниже">↓</button>
                  <button className="bme-mini bme-mini--danger" onClick={() => delGroup(gi)} disabled={draft.length <= 1} aria-label="Удалить группу">✕</button>
                </div>
                {g.categories.map((c, ci) => (
                  <div className="bme-cat" key={ci}>
                    <button
                      className={`bme-cat__btn${sel.g === gi && sel.c === ci ? ' bme-cat__btn--active' : ''}`}
                      onClick={() => setSel({ g: gi, c: ci })}
                      title={c.title}
                    >
                      {c.title || '—'} <span style={{ opacity: 0.5 }}>· {c.items.length}</span>
                    </button>
                    <button className="bme-mini" onClick={() => moveCat(gi, ci, -1)} disabled={ci === 0} aria-label="Выше">↑</button>
                    <button className="bme-mini" onClick={() => moveCat(gi, ci, 1)} disabled={ci === g.categories.length - 1} aria-label="Ниже">↓</button>
                    <button className="bme-mini bme-mini--danger" onClick={() => delCat(gi, ci)} aria-label="Удалить категорию">✕</button>
                  </div>
                ))}
                <button className="bme-add bme-add--sub" onClick={() => addCat(gi)}>+ категория</button>
              </div>
            ))}
            <button className="bme-add" onClick={addGroup}>+ группа</button>
          </div>

          {/* редактор выбранной категории */}
          <div className="bme-editor">
            {!cat ? (
              <div className="bme-empty">Выберите категорию слева</div>
            ) : (
              <>
                <div className="bme-field">
                  <label className="bme-lbl">Название категории</label>
                  <input className="bme-input" value={cat.title} onChange={(e) => patchCat('title', e.target.value)} />
                </div>
                <div className="bme-row">
                  <div className="bme-field">
                    <label className="bme-lbl">Объём по умолчанию</label>
                    <input className="bme-input" value={cat.unit} onChange={(e) => patchCat('unit', e.target.value)} placeholder="напр. 50 мл" />
                  </div>
                </div>
                <div className="bme-field">
                  <label className="bme-lbl">История раздела (правая панель)</label>
                  <textarea className="bme-textarea" rows={3} value={cat.story} onChange={(e) => patchCat('story', e.target.value)} />
                </div>
                <div className="bme-row">
                  <div className="bme-field">
                    <label className="bme-lbl">Цитата (текст)</label>
                    <input className="bme-input" value={cat.quoteText} onChange={(e) => patchCat('quoteText', e.target.value)} />
                  </div>
                  <div className="bme-field">
                    <label className="bme-lbl">Подпись цитаты</label>
                    <input className="bme-input" value={cat.quoteAuthor} onChange={(e) => patchCat('quoteAuthor', e.target.value)} />
                  </div>
                </div>

                <div className="bme-items-head">
                  <span className="bme-items-head__title">Позиции · {cat.items.length}</span>
                  <button className="bme-add" style={{ width: 'auto', marginTop: 0, padding: '6px 12px' }} onClick={addItem}>+ позиция</button>
                </div>

                {cat.items.map((it, ii) => (
                  <div className="bme-item" key={ii}>
                    <div className="bme-item__fields">
                      <input className="bme-input" value={it.name} onChange={(e) => patchItem(ii, 'name', e.target.value)} placeholder="Название *" />
                      <input className="bme-input" value={it.origin} onChange={(e) => patchItem(ii, 'origin', e.target.value)} placeholder="Состав / происхождение (курсивом)" />
                      <div className="bme-item__row2">
                        <input className="bme-input" value={it.volume} onChange={(e) => patchItem(ii, 'volume', e.target.value)} placeholder="Объём (если свой)" />
                        <input className="bme-input" value={it.price} onChange={(e) => patchItem(ii, 'price', e.target.value)} placeholder="Цена" />
                      </div>
                    </div>
                    <button className="bme-mini" onClick={() => moveItem(ii, -1)} disabled={ii === 0} aria-label="Выше">↑</button>
                    <button className="bme-mini" onClick={() => moveItem(ii, 1)} disabled={ii === cat.items.length - 1} aria-label="Ниже">↓</button>
                    <button className="bme-mini bme-mini--danger" onClick={() => delItem(ii)} aria-label="Удалить позицию">✕</button>
                  </div>
                ))}
                {!cat.items.length && <div className="bme-empty">Пока нет позиций — добавьте первую</div>}
              </>
            )}
          </div>
        </div>

        <div className="bme-foot">
          <p className="bme-note">Изменения сразу появятся на сайте. В поиск (пререндер&nbsp;/menu) они попадут после следующего деплоя.</p>
          {err && <span className="bme-error">{err}</span>}
          <button className="bme-btn" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="bme-btn bme-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
