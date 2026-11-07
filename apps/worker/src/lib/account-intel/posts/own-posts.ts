/**
 * What the company publishes itself (slice 12): newsroom RSS or Atom feeds
 * linked from its own pages, Google News sitemap entries listed in its
 * robots.txt, and an IR release feed when one is on file. Only the title, a
 * short excerpt, the link and the date are kept.
 */
import { createHash } from 'node:crypto';

import { classifyPost, cleanText, type InitiativeTheme, type IntelPostKind } from '@bidstack/shared';

import { parseFeed } from '../../watchdog/news.js';
import { webUrl, type IntelClient } from '../http.js';

/** A company post ready to store. */
export interface OwnPost {
  externalId: string;
  source: 'newsroom' | 'sitemap' | 'ir_feed';
  url: string;
  title: string;
  excerpt: string;
  kind: IntelPostKind;
  theme: InitiativeTheme | null;
  publishedAt: Date | null;
}

const MAX_EXCERPT = 280;
const MAX_POSTS = 60;
const MAX_AGE_DAYS = 730;

function abs(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** RSS or Atom feeds advertised in a page's head. */
export function discoverFeeds(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    const url = href ? abs(href, baseUrl) : null;
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Google News sitemap entries: title, link and publication date. */
export function parseNewsSitemap(xml: string): Array<{ title: string; url: string; publishedAt: Date | null }> {
  const out: Array<{ title: string; url: string; publishedAt: Date | null }> = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/gi) ?? []) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(block)?.[1];
    const title = /<news:title>([\s\S]*?)<\/news:title>/i.exec(block)?.[1];
    if (!loc || !title) continue;
    const when = /<news:publication_date>([^<]+)<\/news:publication_date>/i.exec(block)?.[1];
    const at = when ? new Date(when.trim()) : null;
    out.push({ title: cleanText(title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')), url: loc, publishedAt: at && !Number.isNaN(at.getTime()) ? at : null });
  }
  return out;
}

function sitemapChildren(xml: string): string[] {
  if (!/<sitemapindex/i.test(xml)) return [];
  return [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)].map((m) => m[1]!).filter((u) => /news|press|media/i.test(u));
}

function onDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const d = domain.toLowerCase().replace(/^www\./, '');
    return host === d || host.endsWith(`.${d}`);
  } catch {
    return false;
  }
}

function hashId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

function excerptOf(text: string, fallback: string): string {
  const t = cleanText(text);
  if (!t) return fallback;
  return t.length > MAX_EXCERPT ? `${t.slice(0, MAX_EXCERPT - 3).trimEnd()}...` : t;
}

/** Account inputs for a posts fetch. */
export interface PostsTarget {
  domain: string | null;
  newsroomUrl: string | null;
  irFeedUrl: string | null;
}

/** Fetch and classify the company's own posts. */
export async function fetchOwnPosts(client: IntelClient, t: PostsTarget, now: Date = new Date()): Promise<{ posts: OwnPost[]; errors: string[]; newsroomUrl: string | null }> {
  const errors: string[] = [];
  const byUrl = new Map<string, OwnPost>();
  const cutoff = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const domain = t.domain?.replace(/^www\./, '') ?? (webUrl(t.newsroomUrl) ? new URL(t.newsroomUrl!).hostname : null);
  let foundFeed: string | null = null;

  const add = (source: OwnPost['source'], rawUrl: string, title: string, description: string, at: Date | null) => {
    const url = webUrl(rawUrl);
    if (!url || byUrl.has(url) || byUrl.size >= MAX_POSTS) return;
    if (source !== 'ir_feed' && domain && !onDomain(url, domain)) return;
    if (at && at.getTime() < cutoff) return;
    const cls = classifyPost(title, description);
    byUrl.set(url, { externalId: hashId(url), source, url, title, excerpt: excerptOf(description, title), kind: cls.kind, theme: cls.theme, publishedAt: at });
  };

  const readFeed = async (url: string, source: OwnPost['source']) => {
    const xml = await client.get(url, { accept: 'application/rss+xml, application/atom+xml, application/xml' });
    for (const it of parseFeed(xml, 'company_rss')) add(source, it.url, it.title, it.description, it.publishedAt);
  };

  if (t.irFeedUrl) {
    try {
      await readFeed(t.irFeedUrl, 'ir_feed');
    } catch (err) {
      errors.push(`IR feed: ${(err as Error).message}`);
    }
  }

  const pages = [webUrl(t.newsroomUrl), domain ? `https://www.${domain}/` : null].filter((x): x is string => !!x);
  const feeds: string[] = [];
  for (const page of pages) {
    try {
      const body = await client.get(page, { accept: 'text/html, application/rss+xml' });
      if (/^\s*(<\?xml[^>]*>\s*)?<(rss|feed)\b/i.test(body)) {
        for (const it of parseFeed(body, 'company_rss')) add('newsroom', it.url, it.title, it.description, it.publishedAt);
        foundFeed ??= page;
      } else {
        for (const f of discoverFeeds(body, page)) if (!feeds.includes(f) && (!domain || onDomain(f, domain))) feeds.push(f);
      }
    } catch (err) {
      if (page === t.newsroomUrl) errors.push(`newsroom page: ${(err as Error).message}`);
    }
  }
  for (const f of feeds.slice(0, 3)) {
    try {
      await readFeed(f, 'newsroom');
      foundFeed ??= f;
    } catch (err) {
      errors.push(`feed ${f}: ${(err as Error).message}`);
    }
  }

  if (domain) {
    const rules = await client.robots(`https://www.${domain}`);
    const queue = rules.sitemaps.filter((u) => onDomain(u, domain)).slice(0, 3);
    let followed = 0;
    while (queue.length) {
      const sm = queue.shift()!;
      try {
        const xml = await client.get(sm, { accept: 'application/xml' });
        if (/<news:news>/i.test(xml)) for (const it of parseNewsSitemap(xml)) add('sitemap', it.url, it.title, '', it.publishedAt);
        for (const child of sitemapChildren(xml)) if (followed < 2 && onDomain(child, domain)) {
          queue.push(child);
          followed++;
        }
      } catch (err) {
        errors.push(`sitemap ${sm}: ${(err as Error).message}`);
      }
    }
  }

  const posts = [...byUrl.values()].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  return { posts, errors, newsroomUrl: t.newsroomUrl ?? foundFeed };
}
