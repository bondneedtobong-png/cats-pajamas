import { useReveal } from '../useReveal.js';

// Виджет 2ГИС для организации «The Cat's Pajamas Club» (карточка владельца,
// код получен через «Поделиться» → «Виджет для сайта» на 2gis.ru). ВАЖНО:
// готовый embed-код 2ГИС — это <script>, который вызывает new DGWidgetLoader()
// и сам вставляет <iframe> через document.write(). document.write() после
// загрузки страницы (а у нас SPA — всегда после) либо тихо игнорируется
// браузером, либо в худшем случае стирает всю страницу. Поэтому вместо
// скрипта строим тот же URL виджета вручную (алгоритм взят из самого
// DGWidgetLoader.js) и рендерим обычным <iframe>, как и раньше с Яндексом —
// безопасно для React, тот же визуальный результат.
const GIS_WIDGET_SRC = `https://widgets.2gis.com/widget?type=firmsonmap&options=${encodeURIComponent(
  JSON.stringify({
    pos: { lat: 53.19053685426516, lon: 50.09037137031556, zoom: 16 },
    opt: { city: 'samara' },
    org: '70000001101561088',
  })
)}`;

export default function Contacts({ tx }) {
  const r0   = useReveal(0);
  const r1   = useReveal(100);
  const rInfo = useReveal(0);
  const rMap  = useReveal(150);

  return (
    <section id="contacts" className="contacts">
      <div className="contacts__inner">
        {/* Финальный CTA перед контактами — раньше жил отдельной страницей
            книги (Booking.jsx, теперь неиспользуемый), в макете владельца
            переехал сюда как вступление к последней главе. Тексты те же
            (tx.bookingLabel/bookingTitle), новых ключей не потребовалось. */}
        <div className="contacts__cta">
          <span className="sec-label">{tx.bookingLabel}</span>
          <h2 className="contacts__cta-title">{tx.bookingTitle}</h2>
          <a href="/booking" className="hero__btn">{tx.heroCta}</a>
        </div>

        <div ref={r0} className="reveal mb-10">
          <span className="sec-label">{tx.contactsLabel}</span>
        </div>
        <h2 ref={r1} className="reveal contacts__title">{tx.contactsTitle}</h2>

        <div className="contacts__grid">
          <div ref={rInfo} className="reveal contacts__info">
            <div>
              <div className="contacts__block-label">{tx.addressLabel}</div>
              <p className="contacts__block-value" style={{ margin: 0 }}>{tx.address}</p>
            </div>
            <div>
              <div className="contacts__block-label">{tx.hoursLabel}</div>
              <div className="contacts__hours">
                <div>{tx.daysWeek} — 17:00 – 02:00</div>
                <div>{tx.daysWend} — 16:00 – 04:00</div>
              </div>
            </div>
            <div>
              <div className="contacts__block-label">{tx.phoneLabel}</div>
              <a href="tel:+79084180009" className="contacts__phone">+7 (908) 418-00-09</a>
            </div>
            <div className="contacts__socials">
              <a
                href="https://www.instagram.com/cat___pajamas/"
                target="_blank"
                rel="noopener noreferrer"
                className="contacts__social contacts__social--ig"
              >
                <svg className="contacts__social-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
                <span className="contacts__social-label">Instagram</span>
              </a>
              <a
                href="https://t.me/catspajajam"
                target="_blank"
                rel="noopener noreferrer"
                className="contacts__social contacts__social--tg"
              >
                <svg className="contacts__social-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"/>
                </svg>
                <span className="contacts__social-label">Telegram</span>
              </a>
            </div>
          </div>

          <div ref={rMap} className="reveal contacts__map">
            <iframe
              src={GIS_WIDGET_SRC}
              title="The Cat's Pajamas Club на 2ГИС"
              width="100%"
              height="100%"
              frameBorder="0"
              loading="lazy"
              style={{ display: 'block', minHeight: '300px', border: 'none', flex: 1 }}
            />
            <a
              href="https://2gis.ru/samara/firm/70000001101561088"
              target="_blank"
              rel="noopener noreferrer"
              className="contacts__map-link"
            >
              {tx.mapLabel}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
