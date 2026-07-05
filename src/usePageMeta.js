import { useEffect } from 'react';

// Per-route <head> для SPA: на монтировании ставит title/description/canonical
// (и опционально noindex), на размонтировании возвращает значения по умолчанию
// из index.html — чтобы главная ('/') не унаследовала мету подстраницы.
// Отдаёт корректную мету ботам, исполняющим JS. Для /menu основной SEO-путь —
// статический пререндер (scripts/prerender-menu.mjs), это лишь дубль на клиенте.
export function usePageMeta({ title, description, canonical, noindex = false } = {}) {
  useEffect(() => {
    const descEl = document.querySelector('meta[name="description"]');
    const canonicalEl = document.querySelector('link[rel="canonical"]');

    const prevTitle = document.title;
    const prevDesc = descEl?.getAttribute('content');
    const prevCanonical = canonicalEl?.getAttribute('href');

    if (title) document.title = title;
    if (description && descEl) descEl.setAttribute('content', description);
    if (canonical && canonicalEl) canonicalEl.setAttribute('href', canonical);

    // robots=noindex — тег создаём, только если его ещё нет в <head>.
    let robotsEl = document.querySelector('meta[name="robots"]');
    const robotsExisted = !!robotsEl;
    const prevRobots = robotsEl?.getAttribute('content');
    if (noindex) {
      if (!robotsEl) {
        robotsEl = document.createElement('meta');
        robotsEl.setAttribute('name', 'robots');
        document.head.appendChild(robotsEl);
      }
      robotsEl.setAttribute('content', 'noindex, nofollow');
    }

    return () => {
      document.title = prevTitle;
      if (prevDesc != null) descEl?.setAttribute('content', prevDesc);
      if (prevCanonical != null) canonicalEl?.setAttribute('href', prevCanonical);
      if (noindex) {
        if (robotsExisted) robotsEl?.setAttribute('content', prevRobots ?? '');
        else robotsEl?.remove();
      }
    };
  }, [title, description, canonical, noindex]);
}
