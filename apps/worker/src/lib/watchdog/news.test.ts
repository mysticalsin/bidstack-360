import { describe, expect, it, vi } from 'vitest';

import { mapApolloFundingEvents } from '../../account-enrichment/providers.js';
import {
  apifyInput,
  fetchAccountNews,
  memoryNewsCache,
  mentionsCompany,
  newsConfigFromEnv,
  newsExternalId,
  parseFeed,
  parseGdelt,
  processNews,
  runAccountNews,
  type NewsFetch,
  type NewsItem,
  type NewsRow,
  type NewsStore,
  type NewsSubject,
} from './news.js';

const NOW = new Date('2026-10-31T12:00:00Z');
const subject: NewsSubject = {
  orgId: 'o1',
  companyId: 'c1',
  companyName: 'Acme Corp',
  domain: 'acme.com',
  ticker: 'ACME',
  exchange: 'NYSE',
  irFeedUrl: 'https://acme.com/press.rss',
  linkedinUrl: 'https://www.linkedin.com/company/acme',
  alertUserIds: ['u1'],
};

const GDELT = JSON.stringify({
  articles: [
    { url: 'https://news.example/a?utm_source=x', title: 'Acme (NYSE: ACME) raises $40M Series C led by Atomico', seendate: '20261029T101500Z', domain: 'news.example' },
    { url: 'https://other.example/b', title: 'Series C: Acme raises $40M, led by Atomico', seendate: '20261029T121500Z', domain: 'other.example' },
    { url: 'https://noise.example/c', title: 'Acmeville wins football cup', seendate: '20261029T121500Z', domain: 'noise.example' },
    { url: 'https://old.example/d', title: 'Acme opens new hub in Lisbon', seendate: '20260901T121500Z', domain: 'old.example' },
  ],
});
const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Acme (NYSE:ACME) launches new mobile banking app - Reuters]]></title><link>https://reuters.example/x</link><pubDate>Thu, 30 Oct 2026 09:00:00 GMT</pubDate><source url="https://reuters.example">Reuters</source><description>&lt;p&gt;Acme unveiled an app.&lt;/p&gt;</description></item>
</channel></rss>`;
const ATOM = `<feed><entry><title>Acme appoints new chief data officer</title><link href="https://acme.com/press/cdo"/><updated>2026-10-28T08:00:00Z</updated><summary>Jane Doe joins.</summary></entry></feed>`;

function fakeFetch(map: Record<string, string>, calls: string[] = []): NewsFetch {
  return async (url) => {
    calls.push(url);
    const key = Object.keys(map).find((k) => url.includes(k));
    return { ok: !!key, status: key ? 200 : 404, text: async () => (key ? map[key]! : '') };
  };
}

describe('parsers', () => {
  it('parses GDELT article lists and ignores bad payloads', () => {
    expect(parseGdelt(GDELT)).toHaveLength(4);
    expect(parseGdelt('Invalid query')).toEqual([]);
  });
  it('parses RSS and Atom', () => {
    const rss = parseFeed(RSS, 'google_news');
    expect(rss[0]?.title).toBe('Acme (NYSE:ACME) launches new mobile banking app - Reuters');
    expect(rss[0]?.publisherUrl).toBe('https://reuters.example');
    expect(rss[0]?.publisher).toBe('Reuters');
    expect(rss[0]?.description).toBe('Acme unveiled an app.');
    const atom = parseFeed(ATOM, 'company_rss');
    expect(atom[0]?.url).toBe('https://acme.com/press/cdo');
  });
});

describe('config flags', () => {
  it('is off by default', () => {
    expect(newsConfigFromEnv({}).sources).toEqual([]);
  });
  it('turns on listed free sources only', () => {
    expect(newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'gdelt, google_news,bogus,apify_linkedin' }).sources).toEqual(['gdelt', 'google_news']);
  });
  it('needs the flag, a token and an actor for Apify LinkedIn', () => {
    expect(newsConfigFromEnv({ APIFY_TOKEN: 't', WATCHDOG_APIFY_LINKEDIN_ACTOR: 'a/b' }).apify).toBeNull();
    const c = newsConfigFromEnv({ WATCHDOG_APIFY_LINKEDIN_ENABLED: 'true', APIFY_TOKEN: 't', WATCHDOG_APIFY_LINKEDIN_ACTOR: 'acme/posts' });
    expect(c.sources).toContain('apify_linkedin');
    expect(c.apify?.actor).toBe('acme~posts');
  });
  it('refuses login material in Apify input', () => {
    expect(() => apifyInput('https://www.linkedin.com/company/acme', { cookie: 'x' })).toThrow(/cookies/);
    expect(() => apifyInput('https://www.linkedin.com/in/someone')).toThrow(/company URL/);
  });
});

describe('processNews', () => {
  it('keeps items naming the account, drops old ones and merges the same story', () => {
    const items = parseGdelt(GDELT);
    const rows = processNews(subject, items, { now: NOW, lookbackDays: 14 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('FUNDING_ROUND');
    expect(rows[0]?.mentions).toBe(2);
    expect(rows[0]?.importance).toBeGreaterThanOrEqual(75);
    expect(rows[0]?.externalId).toBe('https://news.example/a');
  });
  it('matches the name without legal suffixes', () => {
    expect(mentionsCompany('Acme launches app', 'Acme Corp')).toBe(true);
    expect(mentionsCompany('Acmeville wins', 'Acme Corp')).toBe(false);
  });
  it('strips tracking params from ids', () => {
    expect(newsExternalId('https://x.example/a?utm_medium=y&id=2#top')).toBe('https://x.example/a?id=2');
  });
});

describe('fetchAccountNews', () => {
  it('calls only configured sources and caches responses', async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch({ 'api.gdeltproject.org': GDELT, 'news.google.com': RSS, 'acme.com/press.rss': ATOM }, calls);
    const cache = memoryNewsCache();
    const config = newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'gdelt,google_news,company_rss' });
    const a = await fetchAccountNews(subject, { fetchImpl, cache, config });
    expect(a.errors).toEqual([]);
    expect(a.items.length).toBe(6);
    await fetchAccountNews(subject, { fetchImpl, cache, config });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('%22Acme%22');
  });
  it('makes no call when nothing is configured', async () => {
    const fetchImpl = vi.fn() as unknown as NewsFetch;
    const r = await fetchAccountNews(subject, { fetchImpl, cache: memoryNewsCache(), config: newsConfigFromEnv({}) });
    expect(r.items).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('reports a failing source without the others failing', async () => {
    const fetchImpl = fakeFetch({ 'news.google.com': RSS });
    const r = await fetchAccountNews(subject, { fetchImpl, cache: memoryNewsCache(), config: newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'gdelt,google_news' }) });
    expect(r.errors).toEqual(['gdelt HTTP 404']);
    expect(r.items).toHaveLength(1);
  });
  it('sends the Apify token as a header, never in the URL', async () => {
    const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
    const fetchImpl: NewsFetch = async (url, init) => {
      seen.push({ url, headers: init?.headers });
      return { ok: true, status: 200, text: async () => JSON.stringify([{ text: 'Acme is hiring 200 engineers in Porto', url: 'https://www.linkedin.com/feed/update/1', postedAt: '2026-10-30T10:00:00Z' }]) };
    };
    const config = newsConfigFromEnv({ WATCHDOG_APIFY_LINKEDIN_ENABLED: 'true', APIFY_TOKEN: 'secret-token', WATCHDOG_APIFY_LINKEDIN_ACTOR: 'acme/posts' });
    const r = await fetchAccountNews(subject, { fetchImpl, cache: memoryNewsCache(), config });
    expect(r.items[0]?.source).toBe('apify_linkedin');
    expect(seen[0]?.url).not.toContain('secret-token');
    expect(seen[0]?.headers?.authorization).toBe('Bearer secret-token');
  });
});

describe('runAccountNews', () => {
  function memStore(existing: Array<{ id: string; dedupeKey: string; mentions: number; kind: string; implication: 'OPPORTUNITY'; source: string }> = []) {
    const inserted: NewsRow[] = [];
    const bumps: Array<[string, number, number]> = [];
    const notes: string[] = [];
    const store: NewsStore = {
      findByDedupeKeys: async (_o, _c, keys) => existing.filter((e) => keys.includes(e.dedupeKey)),
      insert: async (rows) => {
        inserted.push(...rows);
        return rows;
      },
      bump: async (id, m, i) => {
        bumps.push([id, m, i]);
      },
      notify: async (n) => {
        notes.push(n.title);
      },
    };
    return { store, inserted, bumps, notes };
  }

  it('inserts, then alerts on important items only', async () => {
    const m = memStore();
    const fetchImpl = fakeFetch({ 'api.gdeltproject.org': GDELT, 'news.google.com': RSS });
    // The second GDELT story has no ticker in its title: its page says so.
    const pages: Record<string, string> = {
      'https://other.example/robots.txt': 'User-agent: *\nDisallow: /private',
      'https://other.example/b': '<html><head><script>var x="NYSE: ACME"</script></head><body><p>Acme Corp (NYSE: ACME) said on Thursday it raised $40M.</p></body></html>',
    };
    const bodyFetch = async (url: string) => ({ ok: url in pages, status: url in pages ? 200 : 404, headers: { get: () => 'text/html' }, body: null, text: async () => pages[url] ?? '' });
    const r = await runAccountNews(subject, { fetchImpl, bodyFetch, sleep: async () => undefined, cache: memoryNewsCache(), config: newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'gdelt,google_news' }), store: m.store, now: NOW });
    expect(r.inserted).toBe(2);
    expect(r.bodyChecks).toBeGreaterThanOrEqual(1);
    expect(r.alerted).toBe(1);
    expect(m.notes[0]).toMatch(/^Opportunity at Acme Corp: Acme \(NYSE: ACME\) raises \$40M/);
    expect(m.inserted.every((x) => !/[\u2014]/.test(x.title))).toBe(true);
  });

  it('bumps mentions on a stored story from another source instead of inserting', async () => {
    const rows = processNews(subject, parseFeed(RSS, 'google_news'), { now: NOW, lookbackDays: 14 });
    const m = memStore([{ id: 'e1', dedupeKey: rows[0]!.dedupeKey, mentions: 1, kind: 'PRODUCT_LAUNCH', implication: 'OPPORTUNITY', source: 'gdelt' }]);
    const r = await runAccountNews(subject, { fetchImpl: fakeFetch({ 'news.google.com': RSS }), cache: memoryNewsCache(), config: newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'google_news' }), store: m.store, now: NOW });
    expect(r.inserted).toBe(0);
    expect(r.merged).toBe(1);
    expect(m.bumps[0]?.[1]).toBe(2);
  });
});

describe('mapApolloFundingEvents', () => {
  it('maps funding events and skips undated ones', () => {
    const s = mapApolloFundingEvents(
      { funding_events: [{ id: 'f1', date: '2026-09-15', type: 'Series C', amount: '40000000', currency: '$', investors: 'Atomico', news_url: 'https://n.example/x' }, { id: 'f2' }] },
      'Acme',
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ externalId: 'funding:f1', kind: 'FUNDING_ROUND', title: 'Acme: Series C of $40.0M', url: 'https://n.example/x' });
  });
});

void ({} as NewsItem);

describe('v22 identifier rule', () => {
  const run = (subj: NewsSubject, map: Record<string, string>) =>
    runAccountNews(subj, { fetchImpl: fakeFetch(map), cache: memoryNewsCache(), config: newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'gdelt,google_news', WATCHDOG_NEWS_VERIFY_BODY: 'false' }), store: { findByDedupeKeys: async () => [], insert: async (r) => r, bump: async () => undefined, notify: async () => undefined }, now: NOW });

  it('fetches nothing for an account without website or ticker', async () => {
    const calls: string[] = [];
    const r = await runAccountNews({ ...subject, domain: null, ticker: null }, { fetchImpl: fakeFetch({ 'news.google.com': RSS }, calls), cache: memoryNewsCache(), config: newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'google_news' }), store: { findByDedupeKeys: async () => [], insert: async (x) => x, bump: async () => undefined, notify: async () => undefined }, now: NOW });
    expect(r.skipped).toBe('no_identifiers');
    expect(calls).toEqual([]);
  });

  it('treats a placeholder domain as missing', async () => {
    const r = await run({ ...subject, domain: 'example.org', ticker: null }, { 'news.google.com': RSS });
    expect(r.skipped).toBe('no_identifiers');
  });

  it('drops name-only stories when the body check is off', async () => {
    const r = await run(subject, { 'api.gdeltproject.org': GDELT });
    // Only the title with "NYSE: ACME" survives; Acmeville and the name-only copy go.
    expect(r.kept).toBe(1);
    expect(r.dropped).toBeGreaterThanOrEqual(2);
  });

  it('asks Google News for the ticker or domain next to the name', async () => {
    const calls: string[] = [];
    await runAccountNews(subject, { fetchImpl: fakeFetch({ 'news.google.com': RSS }, calls), cache: memoryNewsCache(), config: newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'google_news' }), store: { findByDedupeKeys: async () => [], insert: async (x) => x, bump: async () => undefined, notify: async () => undefined }, now: NOW });
    expect(decodeURIComponent(calls[0]!)).toContain('"Acme" ("ACME" OR "acme.com") when:14d');
  });

  it('keeps a Google News story whose publisher is the company site', async () => {
    const own = `<rss><channel><item><title>Acme opens Lisbon hub</title><link>https://news.google.com/rss/articles/x</link><pubDate>Thu, 30 Oct 2026 09:00:00 GMT</pubDate><source url="https://www.acme.com">Acme</source></item></channel></rss>`;
    const r = await run(subject, { 'news.google.com': own });
    expect(r.kept).toBe(1);
  });
});
