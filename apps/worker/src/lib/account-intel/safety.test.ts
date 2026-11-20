import { describe, expect, it } from 'vitest';

import { aggregatorFromEnv } from './hiring/aggregators.js';
import { createIntelClient, memoryIntelCache, webUrl, type IntelFetch } from './http.js';
import { fetchOwnPosts } from './posts/own-posts.js';
import { parseRobots, robotsAllows } from './robots.js';

const UA = 'PoloAccountIntel/1.0 (+mailto:intel@polo.example)';
const NOW = new Date('2026-11-06T12:00:00Z');

function routes(map: Record<string, string>): IntelFetch {
  return async (url) => {
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
}

const client = (fetchImpl: IntelFetch) => createIntelClient({ fetchImpl, userAgent: UA, cache: memoryIntelCache(() => 0), minGapMs: 0, sleep: async () => undefined });

describe('account intel safety', () => {
  it('keeps only http and https links', () => {
    expect(webUrl('https://acme.example/a')).toBe('https://acme.example/a');
    expect(webUrl('javascript://www.acme.example/%0aalert(1)')).toBeNull();
    expect(webUrl('data:text/html,hi')).toBeNull();
    expect(webUrl(null)).toBeNull();
  });

  it('drops script links from a news sitemap even when the host matches', async () => {
    const sitemap = `<?xml version="1.0"?><urlset xmlns:news="n">
      <url><loc>javascript://www.acme.example/%0aalert(1)</loc><news:news><news:title>Bad</news:title><news:publication_date>2026-11-01</news:publication_date></news:news></url>
      <url><loc>https://www.acme.example/news/good</loc><news:news><news:title>Acme launches a product</news:title><news:publication_date>2026-11-01</news:publication_date></news:news></url>
    </urlset>`;
    const out = await fetchOwnPosts(
      client(routes({ 'https://www.acme.example/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://www.acme.example/news-sitemap.xml', 'https://www.acme.example/news-sitemap.xml': sitemap })),
      { domain: 'acme.example', newsroomUrl: null, irFeedUrl: null },
      NOW,
    );
    expect(out.posts.map((p) => p.url)).toEqual(['https://www.acme.example/news/good']);
  });

  it('bounds the response cache by total size', () => {
    const cache = memoryIntelCache(() => 0, 60_000, 1_000);
    cache.set('a', { status: 200, body: 'x'.repeat(600), at: 0 });
    cache.set('b', { status: 200, body: 'y'.repeat(600), at: 0 });
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')?.body.length).toBe(600);
  });

  it('matches robots groups by exact product token', () => {
    const rules = parseRobots('User-agent: p\nDisallow: /\n\nUser-agent: *\nAllow: /');
    expect(robotsAllows(rules, 'poloaccountintel', '/jobs')).toBe(true);
    expect(robotsAllows(parseRobots('User-agent: PoloAccountIntel\nDisallow: /'), 'poloaccountintel', '/jobs')).toBe(false);
  });

  it('keeps only aggregator results for the same company and skips Adzuna without a country', async () => {
    const adzuna = aggregatorFromEnv({ ACCOUNT_INTEL_JOB_AGGREGATOR: 'adzuna', ADZUNA_APP_ID: 'i', ADZUNA_APP_KEY: 'k' })!;
    const body = JSON.stringify({
      results: [
        { id: 1, title: 'Data Engineer', created: '2026-11-01T00:00:00Z', redirect_url: 'https://www.adzuna.co.uk/1', company: { display_name: 'Acme Ltd' } },
        { id: 2, title: 'Data Engineer', created: '2026-11-01T00:00:00Z', redirect_url: 'javascript:alert(1)', company: { display_name: 'Acme Foods' } },
      ],
    });
    const fetchImpl: IntelFetch = async (url) => (url.includes('/robots.txt') ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => body });
    const rows = await adzuna.fetch(client(fetchImpl), { companyName: 'Acme', domain: null, countryCode: 'GB' });
    expect(rows.map((r) => r.externalId)).toEqual(['1']);
    expect(await adzuna.fetch(client(fetchImpl), { companyName: 'Acme', domain: null, countryCode: null })).toEqual([]);
  });
});
