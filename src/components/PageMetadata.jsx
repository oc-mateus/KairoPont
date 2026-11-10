import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_SITE_URL, getPageMetadata, siteUrl } from '../../shared/site.mjs';

export default function PageMetadata() {
  const { pathname } = useLocation();
  const meta = getPageMetadata(pathname);
  useEffect(() => {
    document.title = meta.title;
    const update = (selector, attributes) => {
      let element = document.head.querySelector(selector);
      if (!element) { element = document.createElement('meta'); document.head.append(element); }
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    };
    update('meta[name="description"]', { name: 'description', content: meta.description });
    update('meta[name="robots"]', { name: 'robots', content: meta.index ? 'index,follow' : 'noindex,nofollow' });
    update('meta[property="og:title"]', { property: 'og:title', content: meta.title });
    update('meta[property="og:description"]', { property: 'og:description', content: meta.description });
    const base = import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL;
    const canonical = document.head.querySelector('link[rel="canonical"]');
    document.head.querySelector('meta[property="og:url"]')?.remove();
    canonical?.remove();
    if (meta.index) {
      const link = document.createElement('link'); link.rel = 'canonical'; link.href = siteUrl(meta.path, base); document.head.append(link);
      update('meta[property="og:url"]', { property: 'og:url', content: link.href });
    }
    window.scrollTo(0, 0);
  }, [pathname, meta.title, meta.description, meta.index, meta.path]);
  return <span className="sr-only" role="status" aria-live="polite">{meta.title}</span>;
}
