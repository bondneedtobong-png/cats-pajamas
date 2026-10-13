import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Direct entry may use the menu prerender, so defaults cannot come from its head.
export const HOME_META = {
  title: "The Cat's Pajamas Club («Пижама Кота») — джаз-бар в Самаре",
  description: '«Пижама Кота» (The Cat\'s Pajamas Club) — авторский коктейль-бар в Самаре. Живой джаз, атмосфера Нью-Йорка 80-х, коктейль под ваш вкус. Ул. Куйбышева, 98.',
  canonical: 'https://cats-pajamas.ru/',
};

export function usePageMeta({ title = HOME_META.title, description = HOME_META.description, canonical, noindex = false } = {}) {
  const { pathname } = useLocation();
  const url = canonical || new URL(pathname, HOME_META.canonical).href;
  useEffect(() => {
    const set = (selector, tag, key, value, attribute = 'content') => {
      const matches = [...document.head.querySelectorAll(selector)];
      let element = matches.shift();
      matches.forEach(duplicate => duplicate.remove());
      if (!element) {
        element = document.createElement(tag);
        for (const [name, val] of Object.entries(key)) element.setAttribute(name, val);
        document.head.appendChild(element);
      }
      element.setAttribute(attribute, value);
    };
    document.title = title;
    set('meta[name="description"]', 'meta', { name: 'description' }, description);
    set('link[rel="canonical"]', 'link', { rel: 'canonical' }, url, 'href');
    for (const [property, value] of [['og:title', title], ['og:description', description], ['og:url', url]]) {
      set(`meta[property="${property}"]`, 'meta', { property }, value);
    }
    for (const [name, value] of [['twitter:title', title], ['twitter:description', description]]) {
      set(`meta[name="${name}"]`, 'meta', { name }, value);
    }
    if (noindex) set('meta[name="robots"]', 'meta', { name: 'robots' }, 'noindex, nofollow');
    else document.head.querySelectorAll('meta[name="robots"]').forEach(element => element.remove());
    // Each route owns its head. Cleanup must not resurrect the entry page's meta.
  }, [title, description, url, noindex]);
}
