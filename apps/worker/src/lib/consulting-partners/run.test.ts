import { describe, expect, it } from 'vitest';

import { DEFAULT_CONSULTING_FIRMS, type PartnerEvidenceDraft, type PartnerPublicItem } from '@bidstack/shared';

import { memoryIntelCache, type IntelFetch } from '../account-intel/http.js';
import { llmPartnerRemarks, partnerFirmSiteUrl, partnerGdeltUrl, partnerGoogleNewsUrl, runConsultingPartners, type PartnerStore } from './run.js';

const NOW = new Date('2026-11-06T12:00:00Z');
const UA = 'PoloPartners/1.0 (+mailto:intel@polo.example)';
const firms = DEFAULT_CONSULTING_FIRMS;

const GDELT = JSON.stringify({
  articles: [
    { url: 'https://news.example.com/mapfre-kpmg', title: 'MAPFRE selects KPMG to lead its finance transformation', seendate: '20261020T080000Z', domain: 'news.example.com' },
    { url: 'https://news.example.com/other', title: 'KPMG opens a new office in Madrid', seendate: '20261021T080000Z', domain: 'news.example.com' },
  ],
});
const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>MAPFRE and Accenture expand cloud alliance - Example Wire</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Tue, 06 Oct 2026 09:00:00 GMT</pubDate><description>MAPFRE and Accenture expand cloud alliance</description><source url="https://wire.example.com">Example Wire</source></item>
</channel></rss>`;
const SITE_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>How MAPFRE modernised claims with data - Capgemini</title><link>https://news.google.com/rss/articles/def</link><pubDate>Mon, 05 Oct 2026 09:00:00 GMT</pubDate><description>Client story</description><source url="https://www.capgemini.com">Capgemini</source></item>
</channel></rss>`;

function recorder() {
  const calls: Array<{ url: string; ua: string | undefined }> = [];
  const fetchImpl: IntelFetch = async (url, init) => {
    calls.push({ url, ua: init?.headers?.['User-Agent'] ?? init?.headers?.['user-agent'] });
    if (url.endsWith('/robots.txt')) return { ok: true, status: 200, text: async () => 'User-agent: *\nAllow: /' };
    if (url.includes('gdeltproject')) return { ok: true, status: 200, text: async () => GDELT };
    if (url.includes('site%3A')) return { ok: true, status: 200, text: async () => SITE_RSS };
    return { ok: true, status: 200, text: async () => RSS };
  };
  return { calls, fetchImpl };
}

function memoryStore(internal: PartnerEvidenceDraft[] = [], stored: PartnerPublicItem[] = []) {
  const saved: PartnerEvidenceDraft[] = [];
  const runs: Array<Record<string, unknown>> = [];
  const store: PartnerStore = {
    subject: async (orgId, companyId) => ({ orgId, companyId, companyName: 'MAPFRE' }),
    firms: async () => [...firms],
    storedItems: async () => stored,
    internal: async () => internal,
    save: async (_o, _c, drafts) => {
      saved.push(...drafts);
      return { new: drafts.length, updated: 0, removed: 0 };
    },
    setRun: async (_o, _c, run) => {
      runs.push(run);
    },
  };
  return { store, saved, runs };
}

const internalDraft = (excerpt: string): PartnerEvidenceDraft => ({
  firmKey: 'kpmg', firmName: 'KPMG', origin: 'internal', source: 'note', method: 'keyword_match', inferred: false, key: 'int:note:n1', url: null,
  recordType: 'note', recordId: 'n1', opportunityId: null, title: 'Debrief', excerpt, occurredAt: NOW, relationship: null, domains: [], context: 'mention',
  sentiment: null, remarks: [], outcome: null, sample: false,
});

describe('consulting partners public queries', () => {
  it('name the client, the firms and the relationship words', () => {
    const g = decodeURIComponent(partnerGdeltUrl('MAPFRE', firms.slice(0, 2)));
    expect(g).toContain('"MAPFRE" ("KPMG" OR "Deloitte") (partner OR selects OR alliance OR transformation)');
    expect(decodeURIComponent(partnerGoogleNewsUrl('MAPFRE', firms.slice(0, 1)))).toContain('"MAPFRE" ("KPMG")');
    expect(decodeURIComponent(partnerFirmSiteUrl('MAPFRE', firms.slice(0, 2))!)).toContain('site:kpmg.com OR site:deloitte.com');
  });
});

describe('runConsultingPartners', () => {
  it('without a contact User-Agent it fetches nothing but still reads our records and stored posts', async () => {
    const { calls, fetchImpl } = recorder();
    const stored: PartnerPublicItem[] = [{ source: 'company_newsroom', url: 'https://mapfre.com/news/1', title: 'MAPFRE appoints EY as statutory auditor', description: '', publishedAt: NOW }];
    const { store, saved, runs } = memoryStore([internalDraft('Our quality is better than KPMG.')], stored);
    const res = await runConsultingPartners({ orgId: 'o', companyId: 'c' }, { store, env: {}, fetchImpl, now: NOW });
    expect(calls).toHaveLength(0);
    expect(saved.map((d) => [d.firmKey, d.source])).toEqual([['ey', 'company_newsroom'], ['kpmg', 'note']]);
    expect(runs.at(-1)).toMatchObject({ status: 'not_configured', lastFetchedAt: NOW });
    expect(String(runs.at(-1)!.detail)).toMatch(/ACCOUNT_INTEL_USER_AGENT/);
    expect(res.counts.new).toBe(2);
  });

  it('sends the contact User-Agent, checks robots.txt, waits for GDELT and keeps only items that name the client', async () => {
    const { calls, fetchImpl } = recorder();
    const sleeps: number[] = [];
    const { store, saved, runs } = memoryStore();
    await runConsultingPartners(
      { orgId: 'o', companyId: 'c' },
      { store, env: { ACCOUNT_INTEL_USER_AGENT: UA }, fetchImpl, now: NOW, cache: memoryIntelCache(), sleep: async (ms) => void sleeps.push(ms) },
    );
    const pages = calls.filter((c) => !c.url.endsWith('/robots.txt'));
    expect(pages.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.ua === UA)).toBe(true);
    expect(calls.some((c) => c.url === 'https://api.gdeltproject.org/robots.txt')).toBe(true);
    expect(Math.max(...sleeps)).toBeGreaterThanOrEqual(5_000);
    expect(calls.some((c) => /linkedin|login/i.test(c.url))).toBe(false);
    const kpmg = saved.find((d) => d.firmKey === 'kpmg')!;
    expect(kpmg).toMatchObject({ source: 'gdelt', relationship: 'implementation', url: 'https://news.example.com/mapfre-kpmg', inferred: false });
    expect(saved.some((d) => d.title?.includes('new office'))).toBe(false);
    expect(saved.find((d) => d.firmKey === 'accenture')).toMatchObject({ source: 'google_news', relationship: 'strategic_partner' });
    expect(saved.find((d) => d.firmKey === 'capgemini')).toMatchObject({ source: 'firm_site', inferred: true });
    expect(runs.at(-1)).toMatchObject({ status: 'ok' });
  });

  it('reports a blocked source as partial and keeps the rest', async () => {
    const { fetchImpl: base } = recorder();
    const fetchImpl: IntelFetch = async (url, init) => (url.includes('gdeltproject') && !url.endsWith('robots.txt') ? { ok: false, status: 429, text: async () => 'slow down' } : base(url, init));
    const { store, saved, runs } = memoryStore();
    const res = await runConsultingPartners({ orgId: 'o', companyId: 'c' }, { store, env: { ACCOUNT_INTEL_USER_AGENT: UA }, fetchImpl, now: NOW, cache: memoryIntelCache(), sleep: async () => undefined });
    expect(res.status).toBe('partial');
    expect(saved.some((d) => d.firmKey === 'accenture')).toBe(true);
    expect(String(runs.at(-1)!.detail)).toMatch(/429/);
  });
});

describe('llmPartnerRemarks', () => {
  it('keeps only verbatim quotes about the same firm and marks them inferred', async () => {
    const d = internalDraft('The client told us KPMG took four months to staff the team.');
    const llm = async () =>
      JSON.stringify({
        remarks: [
          { firm: 'KPMG', dimension: 'speed', favours: 'us', quote: 'KPMG took four months to staff the team' },
          { firm: 'KPMG', dimension: 'price', favours: 'us', quote: 'KPMG is twice our price' },
          { firm: 'Deloitte', dimension: 'quality', favours: 'us', quote: 'took four months' },
        ],
      });
    const added = await llmPartnerRemarks([d], firms, llm);
    expect(added).toBe(1);
    expect(d).toMatchObject({ method: 'llm_extract', inferred: true, remarks: [{ dimension: 'speed', favours: 'us', phrase: 'KPMG took four months to staff the team' }] });
  });

  it('ignores malformed answers', async () => {
    const d = internalDraft('KPMG was mentioned.');
    expect(await llmPartnerRemarks([d], firms, async () => 'not json')).toBe(0);
    expect(d.remarks).toEqual([]);
  });
});
