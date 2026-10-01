import { useReveal } from '../useReveal.js';
import DecoFrame from '../ui/DecoFrame.jsx';

/**
 * Вход в мини-игру «Симулятор бармена» (2026-09-10).
 *
 * Игра — ОТДЕЛЬНОЕ приложение (свой репозиторий `bartender-sim`, Vite +
 * Phaser), которое nginx отдаёт с того же домена по адресу `/game/`. В коде
 * сайта её нет и быть не должно, поэтому здесь только точка входа.
 *
 * Почему обычный <a href="/game/">, а не <Link>: react-router перехватил бы
 * клик и попытался найти маршрут внутри SPA — получили бы 404-страницу сайта
 * вместо игры. Нужен настоящий переход по адресу.
 *
 * Почему новая вкладка: игра запускает Phaser на весь экран и забирает
 * клавиатуру; возвращаться «назад» из неё нечем (кнопки «на сайт» в игре нет).
 * Отдельная вкладка сохраняет открытый лендинг с позицией скролла и сессией.
 *
 * Почему это не «глава», а интерлюдия: главы сайта пронумерованы сквозной
 * римской нумерацией (`sec-label` в src/data.js), и вставка новой главы
 * заставила бы перенумеровать все следующие в двух языках. Игра — забава на
 * полях, а не раздел о баре, поэтому у блока метка «Интерлюдия», компактная
 * высота (не 100svh) и вторичная, не золотая заливкой, кнопка: единственный
 * главный CTA страницы остаётся «Забронировать стол».
 */
export default function GameCta({ tx }) {
  const r = useReveal(0);

  return (
    <section id="game" className="gamecta">
      <div ref={r} className="reveal gamecta__inner">
        <DecoFrame />
        <span className="sec-label">{tx.gameLabel}</span>
        <h2 className="gamecta__title">{tx.gameTitle}</h2>
        <p className="gamecta__text">{tx.gameText}</p>
        <a
          className="gamecta__btn u-glare"
          href="/game/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {tx.gameCta}
        </a>
        <span className="gamecta__hint">{tx.gameHint}</span>
      </div>
    </section>
  );
}
