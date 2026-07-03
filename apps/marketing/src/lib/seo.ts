// Tiny client-side <title>/<meta>/<canonical> manager. No react-helmet
// dependency — we only need to update three tags per route, so a hook keeps
// the bundle lean. Server-side prerender (vite-prerender-plugin or similar)
// can later replace this; the same shape ports without rewriting consumers.

import { useEffect } from 'react';

export interface SeoMeta {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
}

const BASE_URL = 'https://bidstack.dev';
const DEFAULT_OG = `${BASE_URL}/og/og-default.png`;

function upsertMeta(name: string, value: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeo({ title, description, canonical, ogImage }: SeoMeta): void {
  useEffect(() => {
    const fullTitle = title.includes('Polo PreSales') ? title : `${title} — Polo PreSales`;
    document.title = fullTitle;
    upsertMeta('description', description);
    upsertMeta('og:title', fullTitle, 'property');
    upsertMeta('og:description', description, 'property');
    upsertMeta('og:image', ogImage ?? DEFAULT_OG, 'property');
    upsertMeta('og:url', canonical ?? BASE_URL, 'property');
    upsertMeta('twitter:card', 'summary_large_image');
    upsertLink('canonical', canonical ?? BASE_URL);
  }, [title, description, canonical, ogImage]);
}
