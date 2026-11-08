import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { aggregatorFromEnv } from './hiring/aggregators.js';
import { ATS_ADAPTERS, detectAtsBoards, fetchCompanyPostings, parseJobPostingJsonLd } from './hiring/ats.js';
import { createIntelClient, intelUserAgent, memoryIntelCache, RobotsDisallowedError, type IntelFetch } from './http.js';
import { discoverFeeds, fetchOwnPosts, parseNewsSitemap } from './posts/own-posts.js';
import { parseBrregEnhet, parseBrregRegnskap, fetchBrreg } from './registries/brreg.js';
import { companiesHouseProfileFacts } from './registries/companies-house-profile.js';
import { parseRechercheEntreprises } from './registries/france.js';
import { parseGleifRecords } from './registries/gleif.js';
import { parseRobots, robotsAllows } from './robots.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const text = (name: string) => readFileSync(join(FIX, name), 'utf8');
const UA = 'PoloAccountIntel/1.0 (+mailto:intel@polo.example)';
const NOW = new Date('2026-11-06T12:00:00Z');

/** A fetch that only answers recorded URLs and records every call and header. */
function recorded(routes: Record<string, { status?: number; body: string }>) {
  const calls: Array<{ url: string; ua: string | undefined }> = [];
  const fetchImpl: IntelFetch = async (url, init) => {
    calls.push({ url, ua: init?.headers?.['User-Agent'] });
    const hit = routes[url];
    if (!hit) {
      if (url.endsWith('/robots.txt')) return { ok: false, status: 404, text: async () => '' };
      throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    }
    const status = hit.status ?? 200;
    return { ok: status < 400, status, text: async () => hit.body };
  };
  return { calls, fetchImpl };
}

function client(fetchImpl: IntelFetch) {
  return createIntelClient({ fetchImpl, userAgent: UA, cache: memoryIntelCache(() => 0), minGapMs: 0, sleep: async () => undefined });
}

describe('polite HTTP client', () => {
  it('needs a User-Agent that names a contact', () => {
    expect(intelUserAgent({})).toBeNull();
    expect(intelUserAgent({ ACCOUNT_INTEL_USER_AGENT: 'Polo' })).toBeNull();
    expect(intelUserAgent({ ACCOUNT_INTEL_USER_AGENT: UA })).toBe(UA);
    expect(intelUserAgent({ SEC_USER_AGENT: 'Polo ops@polo.example' })).toBe('Polo ops@polo.example');
  });

  it('honours robots.txt, sends the User-Agent and caches responses', async () => {
    const { calls, fetchImpl } = recorded({
      'https://www.acme.example/robots.txt': { body: text('robots.txt') },
      'https://www.acme.example/careers': { body: text('careers-page.html') },
    });
    const c = client(fetchImpl);
    await c.get('https://www.acme.example/careers');
    await c.get('https://www.acme.example/careers');
    await expect(c.get('https://www.acme.example/private/x')).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(calls.map((x) => x.url)).toEqual(['https://www.acme.example/robots.txt', 'https://www.acme.example/careers']);
    expect(calls.every((x) => x.ua === UA)).toBe(true);
  });

  it('parses robots groups with the most specific rule winning', () => {
    const rules = parseRobots(text('robots.txt'));
    expect(robotsAllows(rules, 'PoloAccountIntel', '/careers')).toBe(true);
    expect(robotsAllows(rules, 'PoloAccountIntel', '/careers/internal/1')).toBe(false);
    expect(robotsAllows(rules, 'BadBot', '/careers')).toBe(false);
    expect(rules.sitemaps).toEqual(['https://www.acme.example/news-sitemap.xml']);
  });
});

describe('job boards (public ATS APIs)', () => {
  it('detects ATS boards linked from a careers page', () => {
    expect(detectAtsBoards(text('careers-page.html'))).toEqual([
      { provider: 'greenhouse', board: 'acme' },
      { provider: 'lever', board: 'acme-other' },
    ]);
  });

  it('parses schema.org JobPosting JSON-LD from the careers page', () => {
    const jobs = parseJobPostingJsonLd(text('careers-page.html'), 'https://www.acme.example/careers');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: 'REQ-7781', title: 'Lead Data Engineer, Snowflake', city: 'Oslo', country: 'NO', department: 'Data and Analytics' });
    expect(jobs[0]!.postedAt?.toISOString().slice(0, 10)).toBe('2026-10-28');
  });

  it('gives JSON-LD postings without an id or URL distinct, stable keys', () => {
    const ld = (title: string) => ({ '@type': 'JobPosting', title, datePosted: '2026-10-28', jobLocation: { address: { addressLocality: 'Oslo', addressCountry: 'NO' } } });
    const html = `<script type="application/ld+json">${JSON.stringify([ld('Data Engineer'), ld('Cloud Architect')])}</script>`;
    const jobs = parseJobPostingJsonLd(html, 'https://www.acme.example/careers');
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(2);
    expect(jobs.every((j) => j.externalId !== 'https://www.acme.example/careers')).toBe(true);
    expect(parseJobPostingJsonLd(html, 'https://www.acme.example/careers').map((j) => j.externalId)).toEqual(jobs.map((j) => j.externalId));
  });

  it.each([
    ['greenhouse', 'gitlab', 'greenhouse-jobs.json', 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true'],
    ['lever', 'palantir', 'lever-postings.json', 'https://api.lever.co/v0/postings/palantir?mode=json'],
    ['ashby', 'ashby', 'ashby-board.json', 'https://api.ashbyhq.com/posting-api/job-board/ashby?includeCompensation=false'],
    ['workable', 'acme', 'workable-widget.json', 'https://apply.workable.com/api/v1/widget/accounts/acme'],
    ['smartrecruiters', 'BoschGroup', 'smartrecruiters-postings.json', 'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100'],
    ['recruitee', 'acme', 'recruitee-offers.json', 'https://acme.recruitee.com/api/offers/'],
    ['personio', 'acme', 'personio-jobs.xml', 'https://acme.jobs.personio.de/xml'],
  ] as const)('%s adapter reads the recorded board', (provider, board, fixture, url) => {
    const adapter = ATS_ADAPTERS[provider];
    expect(adapter.url(board)).toBe(url);
    const jobs = adapter.parse(text(fixture), board);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.externalId).toBeTruthy();
      expect(j.title).toBeTruthy();
      expect(j.url === null || /^https:\/\//.test(j.url)).toBe(true);
    }
  });

  it('fetches the configured board first and the careers page JSON-LD, never guessing a board', async () => {
    const { calls, fetchImpl } = recorded({
      'https://www.acme.example/careers': { body: text('careers-page.html') },
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true': { body: text('greenhouse-jobs.json') },
      'https://api.lever.co/v0/postings/acme-other?mode=json': { body: text('lever-postings.json') },
    });
    const res = await fetchCompanyPostings(client(fetchImpl), { domain: 'acme.example', careersUrl: 'https://www.acme.example/careers', atsProvider: null, atsBoard: null });
    expect(res.boards).toEqual([{ provider: 'greenhouse', board: 'acme' }, { provider: 'lever', board: 'acme-other' }]);
    expect(res.postings.some((p) => p.source === 'careers_jsonld')).toBe(true);
    expect(res.postings.some((p) => p.source === 'greenhouse')).toBe(true);
    expect(res.errors).toEqual([]);
    expect(calls.map((c) => c.url)).not.toContain('https://boards-api.greenhouse.io/v1/boards/acme-example/jobs?content=true');
  });

  it('keeps the paid aggregator off unless its env names are set', () => {
    expect(aggregatorFromEnv({})).toBeNull();
    expect(aggregatorFromEnv({ ACCOUNT_INTEL_JOB_AGGREGATOR: 'theirstack' })).toBeNull();
    expect(aggregatorFromEnv({ ACCOUNT_INTEL_JOB_AGGREGATOR: 'theirstack', THEIRSTACK_API_KEY: 'k' })?.id).toBe('theirstack');
    expect(aggregatorFromEnv({ ACCOUNT_INTEL_JOB_AGGREGATOR: 'adzuna', ADZUNA_APP_ID: 'i', ADZUNA_APP_KEY: 'k' })?.id).toBe('adzuna');
  });
});

describe('company own posts', () => {
  it('discovers RSS or Atom feeds from the page head', () => {
    expect(discoverFeeds(text('careers-page.html'), 'https://www.acme.example/careers')).toEqual(['https://www.acme.example/newsroom/feed.xml']);
  });

  it('parses Google News sitemap entries', () => {
    const items = parseNewsSitemap(text('news-sitemap.xml'));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Acme opens new engineering hub in Porto with 300 roles', url: 'https://www.acme.example/press/acme-opens-engineering-hub-in-porto' });
  });

  it('fetches newsroom feed and news sitemap, classifies each post', async () => {
    const { fetchImpl } = recorded({
      'https://www.acme.example/robots.txt': { body: text('robots.txt') },
      'https://www.acme.example/': { body: text('careers-page.html') },
      'https://www.acme.example/newsroom/feed.xml': { body: text('newsroom-feed.xml') },
      'https://www.acme.example/news-sitemap.xml': { body: text('news-sitemap.xml') },
    });
    const res = await fetchOwnPosts(client(fetchImpl), { domain: 'acme.example', newsroomUrl: null, irFeedUrl: null }, NOW);
    expect(res.errors).toEqual([]);
    const kinds = Object.fromEntries(res.posts.map((p) => [p.title, p.kind]));
    expect(kinds['Acme acquires Nordic payments specialist PayCo']).toBe('acquisition');
    expect(kinds['Acme reports third-quarter results: revenue up 6%']).toBe('results');
    expect(kinds['Acme opens new engineering hub in Porto with 300 roles']).toBe('expansion');
    expect(res.posts.every((p) => p.excerpt.length > 0 && p.url.startsWith('https://www.acme.example/'))).toBe(true);
  });
});

describe('registries', () => {
  it('reads Brønnøysund entity and annual accounts', () => {
    expect(parseBrregEnhet(text('brreg-enhet.json'))).toMatchObject({ orgNumber: '984851006', name: 'DNB BANK ASA', employees: 7347, website: 'www.dnb.no' });
    const fy = parseBrregRegnskap(text('brreg-regnskap.json'));
    expect(fy).toMatchObject({ fiscalYear: 2023, periodEnd: '2023-12-31', currency: 'USD' });
    expect(fy!.metrics.revenue?.value).toBe(107174000000);
    expect(fy!.metrics.operatingIncome?.value).toBe(35770000000);
  });

  it('reports the unsupported bank layout instead of failing the run', async () => {
    const { fetchImpl } = recorded({
      'https://data.brreg.no/enhetsregisteret/api/enheter/984851006': { body: text('brreg-enhet.json') },
      'https://data.brreg.no/regnskapsregisteret/regnskap/984851006': { status: 500, body: text('brreg-regnskap-bank-500.json') },
    });
    const res = await fetchBrreg(client(fetchImpl), '984851006');
    expect(res.entity?.employees).toBe(7347);
    expect(res.period).toBeNull();
    expect(res.note).toMatch(/not supported/i);
  });

  it('reads revenue and net income by year from recherche-entreprises', () => {
    const r = parseRechercheEntreprises(text('fr-recherche-entreprises.json'), '330703844');
    expect(r?.name).toBe('CAPGEMINI');
    expect(r?.periods[0]).toMatchObject({ fiscalYear: 2024, currency: 'EUR' });
    expect(r?.periods[0]!.metrics.revenue?.value).toBe(22522000000);
  });

  it('reads LEI records with the local registry id for matching', () => {
    expect(parseGleifRecords(text('gleif-lei-records.json'))).toEqual([
      expect.objectContaining({ lei: '549300GKFG0RYRRQ1414', legalName: 'DNB BANK ASA', country: 'NO', registeredAs: '984851006' }),
    ]);
  });

  it('turns a Companies House profile into dated registry facts', () => {
    const facts = companiesHouseProfileFacts(JSON.parse(text('companies-house-profile.json')) as Record<string, unknown>);
    expect(facts.map((f) => f.label)).toEqual(['Status', 'Incorporated', 'SIC codes', 'Last accounts']);
    expect(facts.find((f) => f.label === 'Last accounts')?.value).toBe('Full accounts to 2025-12-31');
  });
});
