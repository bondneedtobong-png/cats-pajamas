/**
 * Оформление цитаты бармена (секция «Бармены») — латунная табличка.
 *
 * Выбор владельца 2026-08-27 из трёх витринных вариантов (веер, карточка,
 * табличка); остальные удалены вместе с параметром ?quote. Пластина тёплая, но
 * приглушённая: золото по логобуку остаётся акцентом, а не заливкой.
 *
 * Чистый декор: pointer-events: none, без анимаций — цитата и так самый
 * громкий элемент секции.
 */
export default function QuoteFrame() {
  return (
    <span className="qfr qfr--plate" aria-hidden="true">
      <span className="qfr__engrave" />
      <span className="qfr__rivet qfr__rivet--tl" />
      <span className="qfr__rivet qfr__rivet--tr" />
      <span className="qfr__rivet qfr__rivet--bl" />
      <span className="qfr__rivet qfr__rivet--br" />
    </span>
  );
}
