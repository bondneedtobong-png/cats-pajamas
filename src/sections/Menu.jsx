import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import CocktailsService from '../menu/CocktailsService.js';

// Empty glass shown when a cocktail has no photo yet — keeps the layout
// intact instead of a broken <img>, and still gets the zoom-loop animation.
function GlassPlaceholder() {
  return (
    <svg className="menu-carousel__placeholder-icon" viewBox="0 0 64 64" width="120" height="120" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 10h36l-15 22v20h8M31 52v-20L16 10" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M23 62h18" strokeLinecap="round" />
    </svg>
  );
}

export default function Menu({ tx, onBooking }) {
  const [cocktails, setCocktails] = useState([]);
  const [idx,       setIdx]       = useState(0);
  const [loading,   setLoading]   = useState(true);

  const r0 = useReveal(0);
  const r1 = useReveal(100);
  const r2 = useReveal(200);

  useEffect(() => {
    let alive = true;
    CocktailsService.getPublic()
      .then(list => { if (alive) setCocktails(list); })
      .catch(() => { if (alive) setCocktails([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const CATEGORY_LABEL = { classics: tx.menuClassics, signature: tx.menuSignature };
  const current = cocktails[idx];
  const go = (delta) => setIdx(i => (i + delta + cocktails.length) % cocktails.length);
  const ingredients = current?.ingredients
    ? current.ingredients.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <section id="menu" className="menu">
      <div className="menu__inner">
        <div ref={r0} className="reveal mb-10" style={{ textAlign: 'center' }}>
          <span className="sec-label">{tx.menuLabel}</span>
        </div>
        <h2 ref={r1} className="reveal menu__title" style={{ textAlign: 'center' }}>{tx.menuTitle}</h2>

        {loading && <p className="menu__note">{tx.menuLoading}</p>}
        {!loading && !current && <p className="menu__note">{tx.menuEmpty}</p>}

        {!loading && current && (
          <div ref={r2} className="reveal menu-carousel">
            <div className="menu-carousel__image">
              {current.imageUrl ? (
                <img key={current.id} src={current.imageUrl} alt={current.name} className="menu-carousel__photo" loading="lazy" />
              ) : (
                <div key={current.id} className="menu-carousel__placeholder"><GlassPlaceholder /></div>
              )}
              <div className="menu-carousel__image-overlay" />
            </div>

            <div className="menu-carousel__content">
              {CATEGORY_LABEL[current.category] && (
                <span className="menu-carousel__cat">{CATEGORY_LABEL[current.category]}</span>
              )}
              <h3 className="menu-carousel__name">{current.name}</h3>
              {current.taste && <p className="menu-carousel__taste">{current.taste}</p>}

              {ingredients.length > 0 && (
                <ul className="menu-carousel__ing">
                  {ingredients.map((ing) => (
                    <li key={ing}><span className="menu-carousel__ing-dot" />{ing}</li>
                  ))}
                </ul>
              )}

              {current.story && <p className="menu-carousel__story">{current.story}</p>}

              <div className="menu-carousel__footer">
                {current.price && <span className="menu-carousel__price">{current.price}</span>}
                <button type="button" className="menu-carousel__btn" onClick={onBooking}>{tx.menuCta}</button>
              </div>

              {cocktails.length > 1 && (
                <div className="menu-carousel__nav">
                  <button className="menu-carousel__arrow" onClick={() => go(-1)} aria-label="Предыдущий коктейль">‹</button>
                  <div className="menu-carousel__dots">
                    {cocktails.map((c, i) => (
                      <button
                        key={c.id}
                        className={`menu-carousel__dot${i === idx ? ' menu-carousel__dot--active' : ''}`}
                        onClick={() => setIdx(i)}
                        aria-label={c.name}
                      />
                    ))}
                  </div>
                  <button className="menu-carousel__arrow" onClick={() => go(1)} aria-label="Следующий коктейль">›</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Полное бар-меню живёт на /menu (26 карточек в страницу книги не влезают) */}
        <a className="menu__full-link" href="/menu">{tx.menuFullBtn} ›</a>
      </div>
    </section>
  );
}
