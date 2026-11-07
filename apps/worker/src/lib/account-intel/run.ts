/**
 * One account intelligence refresh (slice 12): job boards, company posts,
 * registries and filings for one account, each source recorded separately
 * so the account page can show when it last ran and what it found.
 *
 * Nothing is fetched without an identifying User-Agent. Identifiers are only
 * adopted from an explicit source (a unique GLEIF match, a link on the
 * company's own careers page) and the source is stored as evidence.
 */
import { extractSkills, type IntelSourceKey } from '@bidstack/shared';

import { classifyTitle, regionFor } from '../../account-enrichment/hiring.js';
import { aggregatorFromEnv } from './hiring/aggregators.js';
import { fetchCompanyPostings, type RawPosting } from './hiring/ats.js';
import { createIntelClient, intelUserAgent, memoryIntelCache, type IntelCache, type IntelClient, type IntelFetch } from './http.js';
import { fetchOwnPosts, type OwnPost } from './posts/own-posts.js';
import { brregEntityPage, fetchBrreg } from './registries/brreg.js';
import { fetchCompaniesHouseProfile } from './registries/companies-house-profile.js';
import { annuairePage, fetchFrance } from './registries/france.js';
import { gleifRecordPage, matchLei, readLei } from './registries/gleif.js';
import { fetchOpenCorporates } from './registries/opencorporates.js';
import type { RegistryFact, RegistryPeriod } from './registries/types.js';

/** Identifiers the refresh reads and may fill in. */
export interface IntelIdentifiers {
  lei: string | null;
  secCik: string | null;
  companiesHouseNumber: string | null;
  brregOrgNumber: string | null;
  frSiren: string | null;
  careersUrl: string | null;
  atsProvider: string | null;
  atsBoard: string | null;
  newsroomUrl: string | null;
  irFeedUrl: string | null;
}

/** The account being refreshed. */
export interface IntelSubject {
  orgId: string;
  companyId: string;
  companyName: string;
  domain: string | null;
  countryCode: string | null;
  identifiers: IntelIdentifiers;
}

/** One evidence ledger row to persist. */
export interface EvidenceRow {
  source: string;
  kind: 'identifier' | 'registry' | 'statement';
  key: string;
  label: string | null;
  url: string | null;
  excerpt: string;
  locator: string | null;
  fetchedAt: Date;
  stance?: string | null;
  theme?: string | null;
}

/** A classified posting to persist. */
export interface PostingRow extends RawPosting {
  function: string;
  seniority: string;
  skills: string[];
  region: string;
}

/** What one source run did. */
export interface SourceRunResult {
  status: 'ok' | 'partial' | 'failed' | 'not_configured';
  new: number;
  updated: number;
  skipped: number;
  failed: number;
  detail: string | null;
}

/** Persistence seam (Prisma in production, in-memory in tests). */
export interface IntelStore {
  loadSubject(orgId: string, companyId: string): Promise<IntelSubject | null>;
  saveIdentifiers(s: IntelSubject, patch: Partial<IntelIdentifiers>, evidence: EvidenceRow[]): Promise<void>;
  upsertPostings(s: IntelSubject, rows: PostingRow[]): Promise<{ new: number; updated: number }>;
  upsertPosts(s: IntelSubject, rows: OwnPost[]): Promise<{ new: number; updated: number }>;
  upsertPeriods(s: IntelSubject, source: string, rows: RegistryPeriod[]): Promise<{ new: number; updated: number }>;
  saveEvidence(s: IntelSubject, rows: EvidenceRow[]): Promise<string[]>;
  saveRegistryFacts(s: IntelSubject, source: string, facts: RegistryFact[], url: string, fetchedAt: Date): Promise<void>;
  rebuildThemes(s: IntelSubject, now: Date): Promise<number>;
  recordRun(s: IntelSubject, key: IntelSourceKey, r: SourceRunResult): Promise<void>;
}

/** Dependencies of one run. */
export interface IntelRunDeps {
  store: IntelStore;
  env: Record<string, string | undefined>;
  fetchImpl: IntelFetch;
  now: Date;
  sleep?: (ms: number) => Promise<void>;
  cache?: IntelCache;
  /** Scoped filings pull (EDGAR, ESEF) plus filing-text statements for one account. */
  financials(orgId: string, companyId: string): Promise<{ status: string; periods: number; detail: string | null }>;
}

const NO_UA = 'Set ACCOUNT_INTEL_USER_AGENT (or SEC_USER_AGENT) to a User-Agent that names a contact email';
const sharedCache = memoryIntelCache();

const zero = (status: SourceRunResult['status'], detail: string | null): SourceRunResult => ({ status, new: 0, updated: 0, skipped: 0, failed: 0, detail });

function verdict(saved: number, errors: string[], notes: string[]): SourceRunResult['status'] {
  if (errors.length && saved === 0) return 'failed';
  if (errors.length || notes.length) return saved > 0 || notes.length ? 'partial' : 'failed';
  return 'ok';
}

function classify(p: RawPosting): PostingRow {
  const c = classifyTitle(`${p.title}${p.department ? ` ${p.department}` : ''}`);
  const fn = classifyTitle(p.title).function;
  const skills = [...new Set([...c.skills, ...extractSkills(`${p.title} ${p.department ?? ''}`)])];
  return { ...p, function: fn === 'other' ? c.function : fn, seniority: c.seniority, skills, region: regionFor(p.country && p.country.length === 2 ? p.country : null, p.state) };
}

async function runHiring(s: IntelSubject, client: IntelClient, deps: IntelRunDeps): Promise<SourceRunResult> {
  const id = s.identifiers;
  const res = await fetchCompanyPostings(client, { domain: s.domain, careersUrl: id.careersUrl, atsProvider: id.atsProvider, atsBoard: id.atsBoard });
  const raw = [...res.postings];
  const agg = aggregatorFromEnv(deps.env);
  if (agg) {
    try {
      raw.push(...(await agg.fetch(client, { companyName: s.companyName, domain: s.domain, countryCode: s.countryCode })));
    } catch (err) {
      res.errors.push(`${agg.label}: ${(err as Error).message}`);
    }
  }
  const rows = raw.map(classify);
  const up = rows.length ? await deps.store.upsertPostings(s, rows) : { new: 0, updated: 0 };

  const patch: Partial<IntelIdentifiers> = {};
  const evidence: EvidenceRow[] = [];
  if (!id.careersUrl && res.careersUrl) patch.careersUrl = res.careersUrl;
  const first = res.boards[0];
  if (!id.atsProvider && first && res.careersUrl) {
    patch.atsProvider = first.provider;
    patch.atsBoard = first.board;
    evidence.push({ source: 'careers_page', kind: 'identifier', key: 'ats_board', label: 'Job board', url: res.careersUrl, excerpt: `Careers page links to the ${first.provider} board "${first.board}"`, locator: null, fetchedAt: deps.now });
  }
  if (Object.keys(patch).length) await deps.store.saveIdentifiers(s, patch, evidence);

  const detail = res.errors.length ? res.errors.join('; ') : rows.length ? null : 'No public job board or JobPosting markup found';
  return { status: verdict(rows.length, res.errors, []), new: up.new, updated: up.updated, skipped: 0, failed: res.errors.length, detail };
}

async function runPosts(s: IntelSubject, client: IntelClient, deps: IntelRunDeps): Promise<SourceRunResult> {
  const id = s.identifiers;
  const res = await fetchOwnPosts(client, { domain: s.domain, newsroomUrl: id.newsroomUrl, irFeedUrl: id.irFeedUrl }, deps.now);
  const up = res.posts.length ? await deps.store.upsertPosts(s, res.posts) : { new: 0, updated: 0 };
  if (!id.newsroomUrl && res.newsroomUrl) await deps.store.saveIdentifiers(s, { newsroomUrl: res.newsroomUrl }, []);
  const detail = res.errors.length ? res.errors.join('; ') : res.posts.length ? null : 'No newsroom feed or news sitemap found on the company site';
  return { status: verdict(res.posts.length, res.errors, []), new: up.new, updated: up.updated, skipped: 0, failed: res.errors.length, detail };
}

async function runRegistry(s: IntelSubject, client: IntelClient, deps: IntelRunDeps): Promise<SourceRunResult> {
  const id = { ...s.identifiers };
  const errors: string[] = [];
  const notes: string[] = [];
  let saved = 0;
  let added = 0;
  let updated = 0;
  const country = s.countryCode?.toUpperCase() ?? null;

  try {
    const patch: Partial<IntelIdentifiers> = {};
    const evidence: EvidenceRow[] = [];
    const found = id.lei ? { record: await readLei(client, id.lei), url: gleifRecordPage(id.lei) } : await matchLei(client, s.companyName, country);
    const r = found.record;
    if (r) {
      if (!id.lei) patch.lei = r.lei;
      const local = r.registeredAs && /^\d{9}$/.test(r.registeredAs) ? r.registeredAs : null;
      if (local && r.country === 'NO' && !id.brregOrgNumber) patch.brregOrgNumber = local;
      if (local && r.country === 'FR' && !id.frSiren) patch.frSiren = local;
      if (r.registeredAs && r.country === 'GB' && !id.companiesHouseNumber) patch.companiesHouseNumber = r.registeredAs;
      if (Object.keys(patch).length) {
        evidence.push({ source: 'gleif', kind: 'identifier', key: 'lei', label: 'LEI match', url: gleifRecordPage(r.lei), excerpt: `LEI ${r.lei}: ${r.legalName}, ${r.country ?? 'country unknown'}${r.registeredAs ? `, registered as ${r.registeredAs}` : ''}${r.registeredAt ? ` at ${r.registeredAt}` : ''}`, locator: 'GLEIF Level 1 record', fetchedAt: deps.now });
        await deps.store.saveIdentifiers(s, patch, evidence);
        Object.assign(id, patch);
        saved++;
      }
    } else if (!id.lei) {
      notes.push('GLEIF: no unique LEI match on legal name and country');
    }
  } catch (err) {
    errors.push(`GLEIF: ${(err as Error).message}`);
  }

  if (id.brregOrgNumber) {
    try {
      const b = await fetchBrreg(client, id.brregOrgNumber);
      if (b.entity) {
        const facts: RegistryFact[] = [{ label: 'Registered name', value: b.entity.name }];
        if (b.entity.employees != null) facts.push({ label: 'Employees', value: String(b.entity.employees) });
        if (b.entity.naceLabel) facts.push({ label: 'Industry (NACE)', value: `${b.entity.naceCode ?? ''} ${b.entity.naceLabel}`.trim() });
        if (b.entity.founded) facts.push({ label: 'Founded', value: b.entity.founded });
        if (b.entity.lastAccountsYear) facts.push({ label: 'Last accounts filed', value: b.entity.lastAccountsYear });
        await deps.store.saveRegistryFacts(s, 'brreg', facts, brregEntityPage(id.brregOrgNumber), deps.now);
        saved++;
      }
      if (b.period) {
        const up = await deps.store.upsertPeriods(s, 'brreg', [b.period]);
        added += up.new;
        updated += up.updated;
        saved++;
      }
      if (b.note) notes.push(b.note);
    } catch (err) {
      errors.push(`Brønnøysund: ${(err as Error).message}`);
    }
  }

  if (id.frSiren) {
    try {
      const f = await fetchFrance(client, id.frSiren);
      if (f.parsed?.periods.length) {
        const up = await deps.store.upsertPeriods(s, 'fr_rne', f.parsed.periods);
        added += up.new;
        updated += up.updated;
        saved++;
      } else notes.push('Recherche d\u2019entreprises: no published accounts for this SIREN');
      if (f.parsed) {
        const facts: RegistryFact[] = [{ label: 'Registered name', value: f.parsed.name }];
        if (f.parsed.naf) facts.push({ label: 'Activity (NAF)', value: f.parsed.naf });
        await deps.store.saveRegistryFacts(s, 'fr_rne', facts, annuairePage(id.frSiren), deps.now);
      }
    } catch (err) {
      errors.push(`France: ${(err as Error).message}`);
    }
  }

  if (id.companiesHouseNumber) {
    const key = deps.env.COMPANIES_HOUSE_API_KEY;
    const oc = deps.env.OPENCORPORATES_API_TOKEN;
    try {
      if (key) {
        const ch = await fetchCompaniesHouseProfile(client, key, id.companiesHouseNumber);
        await deps.store.saveRegistryFacts(s, 'companies_house', ch.facts, ch.url, deps.now);
        saved++;
      } else if (oc) {
        const o = await fetchOpenCorporates(client, oc, 'gb', id.companiesHouseNumber);
        if (o.url) await deps.store.saveRegistryFacts(s, 'opencorporates', o.facts, o.url, deps.now);
        saved++;
      } else {
        notes.push('Companies House: set COMPANIES_HOUSE_API_KEY to read the company profile');
      }
    } catch (err) {
      errors.push(`Companies House: ${(err as Error).message}`);
    }
  }

  const detail = [...errors, ...notes].join('; ') || (saved ? null : 'No registry identifier on file or matched');
  return { status: verdict(saved, errors, notes), new: added, updated, skipped: 0, failed: errors.length, detail };
}

/** Refresh the chosen sources for one account and record each result. */
export async function runAccountIntel(job: { orgId: string; companyId: string; sources: IntelSourceKey[] }, deps: IntelRunDeps): Promise<Partial<Record<IntelSourceKey, SourceRunResult>>> {
  const s = await deps.store.loadSubject(job.orgId, job.companyId);
  if (!s) return {};
  const out: Partial<Record<IntelSourceKey, SourceRunResult>> = {};
  const ua = intelUserAgent(deps.env);
  const client = ua
    ? createIntelClient({ fetchImpl: deps.fetchImpl, userAgent: ua, cache: deps.cache ?? sharedCache, minGapMs: Number(deps.env.ACCOUNT_INTEL_MIN_GAP_MS ?? 1000), sleep: deps.sleep })
    : null;
  const runners: Record<Exclude<IntelSourceKey, 'financials'>, (c: IntelClient) => Promise<SourceRunResult>> = {
    hiring: (c) => runHiring(s, c, deps),
    posts: (c) => runPosts(s, c, deps),
    registry: (c) => runRegistry(s, c, deps),
  };

  for (const key of [...new Set(job.sources)]) {
    let r: SourceRunResult;
    try {
      if (key === 'financials') {
        const f = await deps.financials(job.orgId, job.companyId);
        const status = (['ok', 'partial', 'failed', 'not_configured'] as const).find((x) => x === f.status) ?? (f.periods > 0 ? 'ok' : 'partial');
        r = { status, new: f.periods, updated: 0, skipped: 0, failed: status === 'failed' ? 1 : 0, detail: f.detail };
      } else if (!client) {
        r = zero('not_configured', NO_UA);
      } else {
        r = await runners[key](client);
      }
    } catch (err) {
      r = { ...zero('failed', (err as Error).message.slice(0, 300)), failed: 1 };
    }
    out[key] = r;
    await deps.store.recordRun(s, key, r);
  }

  if (Object.values(out).some((r) => r && r.status !== 'not_configured')) await deps.store.rebuildThemes(s, deps.now);
  return out;
}
