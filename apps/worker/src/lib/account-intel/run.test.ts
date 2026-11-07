import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { IntelFetch } from './http.js';
import { gleifSearchUrl } from './registries/gleif.js';
import { runAccountIntel, type IntelStore, type IntelSubject } from './run.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const text = (name: string) => readFileSync(join(FIX, name), 'utf8');
const NOW = new Date('2026-11-06T12:00:00Z');
const UA = 'PoloAccountIntel/1.0 (+mailto:intel@polo.example)';

function subject(over: Partial<IntelSubject['identifiers']> = {}, base: Partial<IntelSubject> = {}): IntelSubject {
  return {
    orgId: 'o1',
    companyId: 'c1',
    companyName: 'DNB Bank',
    domain: 'acme.example',
    countryCode: 'NO',
    identifiers: { lei: null, secCik: null, companiesHouseNumber: null, brregOrgNumber: null, frSiren: null, careersUrl: null, atsProvider: null, atsBoard: null, newsroomUrl: null, irFeedUrl: null, ...over },
    ...base,
  };
}

/** In-memory store: records what the run would persist. */
function fakeStore(s: IntelSubject) {
  const saved = {
    identifiers: {} as Record<string, string>,
    postings: [] as Array<{ externalId: string; source: string; function: string }>,
    posts: [] as Array<{ title: string; kind: string }>,
    periods: [] as Array<{ source: string; fiscalYear: number }>,
    evidence: [] as Array<{ source: string; excerpt: string; url: string | null }>,
    runs: {} as Record<string, { status: string; new: number; failed: number; detail: string | null }>,
    themes: 0,
  };
  const store: IntelStore = {
    loadSubject: async () => s,
    saveIdentifiers: async (_s, patch, ev) => {
      Object.assign(saved.identifiers, patch);
      saved.evidence.push(...ev);
    },
    upsertPostings: async (_s, rows) => {
      saved.postings.push(...rows);
      return { new: rows.length, updated: 0 };
    },
    upsertPosts: async (_s, rows) => {
      saved.posts.push(...rows);
      return { new: rows.length, updated: 0 };
    },
    upsertPeriods: async (_s, source, rows) => {
      saved.periods.push(...rows.map((r) => ({ source, fiscalYear: r.fiscalYear })));
      return { new: rows.length, updated: 0 };
    },
    saveEvidence: async (_s, rows) => {
      saved.evidence.push(...rows);
      return rows.map((_, i) => `ev${i}`);
    },
    saveRegistryFacts: async () => undefined,
    rebuildThemes: async () => {
      saved.themes++;
      return 0;
    },
    recordRun: async (_s, key, r) => {
      saved.runs[key] = r;
    },
  };
  return { store, saved };
}

function recorded(routes: Record<string, { status?: number; body: string }>) {
  const calls: string[] = [];
  const fetchImpl: IntelFetch = async (url) => {
    calls.push(url);
    const hit = routes[url];
    if (!hit) {
      if (url.endsWith('/robots.txt')) return { ok: false, status: 404, text: async () => '' };
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    const status = hit.status ?? 200;
    return { ok: status < 400, status, text: async () => hit.body };
  };
  return { calls, fetchImpl };
}

const deps = (fetchImpl: IntelFetch, store: IntelStore, env: Record<string, string> = { ACCOUNT_INTEL_USER_AGENT: UA }) => ({
  store,
  env,
  fetchImpl,
  now: NOW,
  sleep: async () => undefined,
  financials: async () => ({ status: 'ok', periods: 0, detail: null }),
});

describe('account intel run', () => {
  it('refuses to fetch anything without an identifying User-Agent', async () => {
    const s = subject();
    const { store, saved } = fakeStore(s);
    const { calls, fetchImpl } = recorded({});
    const res = await runAccountIntel({ orgId: 'o1', companyId: 'c1', sources: ['hiring', 'posts', 'registry'] }, deps(fetchImpl, store, {}));
    expect(calls).toEqual([]);
    for (const k of ['hiring', 'posts', 'registry'] as const) {
      expect(res[k]?.status).toBe('not_configured');
      expect(saved.runs[k]?.detail).toMatch(/ACCOUNT_INTEL_USER_AGENT/);
    }
  });

  it('matches the LEI through GLEIF by name and country, then reads Brønnøysund by the registered id', async () => {
    const s = subject();
    const { store, saved } = fakeStore(s);
    const { fetchImpl } = recorded({
      [gleifSearchUrl('DNB Bank', 'NO')]: { body: text('gleif-lei-records.json') },
      'https://data.brreg.no/enhetsregisteret/api/enheter/984851006': { body: text('brreg-enhet.json') },
      'https://data.brreg.no/regnskapsregisteret/regnskap/984851006': { status: 500, body: text('brreg-regnskap-bank-500.json') },
    });
    const res = await runAccountIntel({ orgId: 'o1', companyId: 'c1', sources: ['registry'] }, deps(fetchImpl, store));
    expect(saved.identifiers).toMatchObject({ lei: '549300GKFG0RYRRQ1414', brregOrgNumber: '984851006' });
    // The match itself is evidence: where it came from and what it said.
    expect(saved.evidence.some((e) => e.source === 'gleif' && /DNB BANK ASA/.test(e.excerpt) && e.url?.startsWith('https://search.gleif.org/'))).toBe(true);
    expect(res.registry?.status).toBe('partial');
    expect(res.registry?.detail).toMatch(/not supported/i);
  });

  it('stores careers page and ATS postings with function and skills, and rebuilds themes', async () => {
    const s = subject({ careersUrl: 'https://www.acme.example/careers' });
    const { store, saved } = fakeStore(s);
    const { fetchImpl } = recorded({
      'https://www.acme.example/careers': { body: text('careers-page.html') },
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true': { body: text('greenhouse-jobs.json') },
      'https://api.lever.co/v0/postings/acme-other?mode=json': { status: 503, body: 'down' },
    });
    const res = await runAccountIntel({ orgId: 'o1', companyId: 'c1', sources: ['hiring'] }, deps(fetchImpl, store));
    expect(saved.postings.find((p) => p.source === 'careers_jsonld')).toMatchObject({ externalId: 'REQ-7781', function: 'data' });
    expect(saved.postings.filter((p) => p.source === 'greenhouse').length).toBe(3);
    // One board down: the run reports a partial result with the failure, not a silent success.
    expect(res.hiring).toMatchObject({ status: 'partial', failed: 1 });
    expect(res.hiring?.detail).toMatch(/lever/);
    expect(saved.themes).toBe(1);
  });

  it('runs the scoped financials pull for the financials source', async () => {
    const s = subject({ lei: '549300GKFG0RYRRQ1414' });
    const { store, saved } = fakeStore(s);
    const seen: string[] = [];
    const res = await runAccountIntel(
      { orgId: 'o1', companyId: 'c1', sources: ['financials'] },
      { ...deps(recorded({}).fetchImpl, store), financials: async (orgId: string, companyId: string) => (seen.push(`${orgId}/${companyId}`), { status: 'ok', periods: 4, detail: null }) },
    );
    expect(seen).toEqual(['o1/c1']);
    expect(res.financials).toMatchObject({ status: 'ok', new: 4 });
    expect(saved.runs.financials?.status).toBe('ok');
  });
});
