import { describe, expect, it } from 'vitest';

import {
  htmlToText,
  isPublicHttpUrl,
  isQuotePage,
  mentionsDomain,
  normalizeDomain,
  normalizeTicker,
  readCapped,
  robotsAllows,
  tickerMention,
  usableIdentifiers,
  verifyArticleBody,
  verifyText,
} from './news-verify.js';
import { memoryNewsCache } from './news.js';

const NOS = usableIdentifiers({ companyName: 'NOS', domain: 'nos.pt', ticker: 'NOS', exchange: 'ELI' });
const MAHLE = usableIdentifiers({ companyName: 'MAHLE', domain: 'https://www.mahle.com/en/', ticker: null, exchange: null });
const DNB = usableIdentifiers({ companyName: 'DNB Bank', domain: 'dnb.no', ticker: 'DNB', exchange: 'OSE' });
const CI = usableIdentifiers({ companyName: 'CI Financial', domain: 'ci.com', ticker: 'CIX', exchange: 'TSX' });

describe('normalisers', () => {
  it('cleans domains and refuses placeholders', () => {
    expect(normalizeDomain('https://www.mahle.com/en/')).toBe('mahle.com');
    expect(normalizeDomain('example.org')).toBeNull();
    expect(normalizeDomain('foo.test')).toBeNull();
    expect(normalizeDomain('10.0.0.1')).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
  });
  it('accepts plain and suffixed tickers', () => {
    expect(normalizeTicker('$atz')).toBe('ATZ');
    expect(normalizeTicker('LGT.B')).toBe('LGT.B');
    expect(normalizeTicker('way too long ticker')).toBeNull();
  });
});

describe('domain mentions', () => {
  it('matches the domain and its subdomains only', () => {
    expect(mentionsDomain('More at www.ci.com/en today', 'ci.com')).toBe(true);
    expect(mentionsDomain('See ir.ci.com.', 'ci.com')).toBe(true);
    expect(mentionsDomain('Visit aci.com for details', 'ci.com')).toBe(false);
    expect(mentionsDomain('Visit ci.com.br for details', 'ci.com')).toBe(false);
  });
});

describe('ticker mentions', () => {
  it('trusts a ticker on its own venue', () => {
    expect(tickerMention('Can CI Financial (TSX:CIX) protect its edge?', 'CIX', 'TSX')).toBe('strong');
    expect(tickerMention('Aritzia Inc. (ATZ.TO) shares rise', 'ATZ', 'TSX')).toBe('strong');
    expect(tickerMention('Aritzia Inc. (ATZ:CA) target raised', 'ATZ', 'TSX')).toBe('strong');
    expect(tickerMention('DNB Bank (OB:DNB) Q3 earnings', 'DNB', 'OSE')).toBe('strong');
  });
  it('never trusts the same symbol on another venue (DNB vs Dun and Bradstreet)', () => {
    expect(tickerMention('Dun & Bradstreet (NYSE: DNB) agrees buyout', 'DNB', 'OSE')).toBe('none');
  });
  it('needs a word boundary', () => {
    expect(tickerMention('TSX: CIXX jumps', 'CIX', 'TSX')).toBe('none');
  });
  it('treats a cashtag as weak', () => {
    expect(tickerMention('$NOS slides', 'NOS', 'ELI')).toBe('weak');
  });
});

describe('homonyms (Tony 2026-11-01)', () => {
  it('drops NOS homonyms that only share the word', () => {
    expect(verifyText('NOS Alive festival announces headliners', NOS)).toBeNull();
    expect(verifyText('Inhaled NOS therapy shows promise in trial', NOS)).toBeNull();
    expect(verifyText('$NOS rallies', usableIdentifiers({ companyName: 'NOS', domain: null, ticker: 'NOS', exchange: 'ELI' }))).toBeNull();
  });
  it('keeps NOS stories that cite the venue ticker or the website', () => {
    expect(verifyText('NOS SGPS (ELI: NOS) refinances EUR 380 million', NOS)).toBe('ticker');
    expect(verifyText('NOS.LS falls 1.7 percent', NOS)).toBe('ticker');
    expect(verifyText('Press release available at www.nos.pt', NOS)).toBe('domain');
  });
  it('drops MAHLE homonyms and keeps stories that cite mahle.com', () => {
    expect(verifyText('Mahle scores twice as the visitors win', MAHLE)).toBeNull();
    expect(verifyText('MAHLE opens battery plant, details on mahle.com', MAHLE)).toBe('domain');
  });
  it('drops a DNB story that is about Dun and Bradstreet', () => {
    expect(verifyText('Dun & Bradstreet (NYSE: DNB) to be acquired', DNB)).toBeNull();
    expect(verifyText('DNB Q3 profit beats forecasts', DNB)).toBeNull();
  });
});

describe('quote pages', () => {
  it('flags evergreen quote and screener pages', () => {
    expect(isQuotePage('Aritzia Inc. (ATZ.TO) Stock Price, News, Quote & History - Yahoo! Finance Canada')).toBe(true);
    expect(isQuotePage('Aritzia (TSX:ATZ) - Stock Analysis - Simply Wall St')).toBe(true);
    expect(isQuotePage('Aritzia banks on store openings to double revenue')).toBe(false);
  });
});

describe('safe article fetching', () => {
  it('refuses private, loopback and odd-port URLs', () => {
    expect(isPublicHttpUrl('http://127.0.0.1/x')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.4/x')).toBe(false);
    expect(isPublicHttpUrl('http://localhost:4010/api')).toBe(false);
    expect(isPublicHttpUrl('https://news.example:8443/a')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('https://user:pw@news.example/a')).toBe(false);
    expect(isPublicHttpUrl('https://news.example/a')).toBe(true);
  });
  it('reads robots rules, most specific first', () => {
    const r = 'User-agent: *\nDisallow: /news/\nAllow: /news/public/\n\nUser-agent: BadBot\nDisallow: /';
    expect(robotsAllows(r, '/news/x', 'PoloWatchdog')).toBe(false);
    expect(robotsAllows(r, '/news/public/x', 'PoloWatchdog')).toBe(true);
    expect(robotsAllows(r, '/other', 'PoloWatchdog')).toBe(true);
    expect(robotsAllows('User-agent: PoloWatchdog\nDisallow: /', '/a', 'PoloWatchdog')).toBe(false);
  });
  it('turns HTML into text without scripts', () => {
    const t = htmlToText('<head><meta name="description" content="CI Financial (TSX: CIX) update"><script>alert("TSX: CIX")</script></head><body><p>Hello&nbsp;&amp; welcome</p></body>');
    expect(t).toContain('CI Financial (TSX: CIX) update');
    expect(t).toContain('Hello & welcome');
    expect(t).not.toContain('alert');
  });
  it('caps the bytes it reads', async () => {
    const big = new TextEncoder().encode('a'.repeat(1000));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(big);
        c.close();
      },
    });
    const out = await readCapped({ ok: true, status: 200, body: stream, text: async () => '' }, 2500);
    expect(out.length).toBe(2500);
  });

  const page = (map: Record<string, { status?: number; body: string; type?: string }>, calls: string[] = []) =>
    async (url: string) => {
      calls.push(url);
      const hit = map[url];
      return { ok: !!hit && (hit.status ?? 200) < 400, status: hit?.status ?? 404, headers: { get: () => hit?.type ?? 'text/html' }, body: null, text: async () => hit?.body ?? '' };
    };
  const deps = (fetchImpl: ReturnType<typeof page>) => ({ fetchImpl, cache: memoryNewsCache(), ttl: 3600, userAgent: 'PoloWatchdog/1.0' });

  it('verifies in the body and caches the verdict', async () => {
    const calls: string[] = [];
    const f = page({ 'https://n.example/robots.txt': { status: 404, body: '' }, 'https://n.example/a': { body: '<p>CI Financial Corp. (TSX: CIX) said</p>' } }, calls);
    const d = deps(f);
    expect(await verifyArticleBody('https://n.example/a', CI, d)).toBe('ticker');
    expect(await verifyArticleBody('https://n.example/a', CI, d)).toBe('ticker');
    expect(calls.filter((c) => c.endsWith('/a'))).toHaveLength(1);
  });
  it('respects robots.txt and stays out on a robots server error', async () => {
    const calls: string[] = [];
    const blocked = page({ 'https://b.example/robots.txt': { body: 'User-agent: *\nDisallow: /' }, 'https://b.example/a': { body: 'TSX: CIX' } }, calls);
    expect(await verifyArticleBody('https://b.example/a', CI, deps(blocked))).toBeNull();
    const down = page({ 'https://d.example/robots.txt': { status: 503, body: '' }, 'https://d.example/a': { body: 'TSX: CIX' } }, calls);
    expect(await verifyArticleBody('https://d.example/a', CI, deps(down))).toBeNull();
    expect(calls).not.toContain('https://b.example/a');
    expect(calls).not.toContain('https://d.example/a');
  });
  it('never fetches Google News redirect pages or non-HTML bodies', async () => {
    const calls: string[] = [];
    const f = page({ 'https://p.example/robots.txt': { status: 404, body: '' }, 'https://p.example/a.pdf': { body: 'TSX: CIX', type: 'application/pdf' } }, calls);
    expect(await verifyArticleBody('https://news.google.com/rss/articles/x', CI, deps(f))).toBeNull();
    expect(await verifyArticleBody('https://p.example/a.pdf', CI, deps(f))).toBeNull();
    expect(calls.some((c) => c.includes('news.google.com'))).toBe(false);
  });
});
