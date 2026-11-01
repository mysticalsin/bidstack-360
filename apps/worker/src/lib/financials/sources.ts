/**
 * v23: free, legal financial data sources.
 *
 *   - SEC EDGAR XBRL companyfacts: US and foreign SEC filers (10-K, 10-Q, 20-F, 40-F).
 *     Fair access: descriptive User-Agent with a contact email, at most 10 requests/s.
 *   - filings.xbrl.org: ESEF annual reports of EU/EEA (and UK) listed issuers, by LEI.
 *
 * Companies House (UK) needs a free API key from a registered developer
 * account; without one it is skipped and documented. SEDAR+ (Canada) has no
 * public API.
 */
import { factsFromCompanyFacts, factsFromXbrlJson, textBlocksFromXbrlJson, type CompanyFacts, type RawFact, type XbrlJson } from './xbrl.js';

export interface FinFetch {
  (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Keeps calls to one host at least `minGapMs` apart (EDGAR: 10 req/s means >= 100 ms). */
export function pacer(minGapMs: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let last = 0;
  return async () => {
    const wait = last + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

const LEGAL = new Set(['inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'sa', 'asa', 'ag', 'gmbh', 'se', 'nv', 'bv', 'sgps', 'spa', 'srl', 'ab', 'oyj', 'as', 'adr', 'the', 'group', 'holding', 'holdings', 'of', 'for', 'and', 'p', 'l', 'c', 's', 'a']);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !LEGAL.has(t));
}

/**
 * The filer behind a CIK or LEI must be the account, not a namesake: every
 * core word of one name has to appear in the other ("DNB Bank" = "DNB BANK
 * ASA", but "Rush University System for Health" is not "RUSH ENTERPRISES").
 */
export function entityNameMatches(accountName: string, entityName: string): boolean {
  const a = nameTokens(accountName);
  const e = nameTokens(entityName);
  if (!a.length || !e.length) return false;
  const es = new Set(e);
  const as = new Set(a);
  return a.every((t) => es.has(t)) || e.every((t) => as.has(t));
}

export const padCik = (cik: string | number) => String(cik).replace(/\D/g, '').padStart(10, '0');

export interface PulledEntity {
  source: 'sec_edgar' | 'esef';
  entityId: string;
  entityName: string;
  facts: RawFact[];
  /** Link per period end (filing or report viewer). */
  urlFor: (periodEnd: string) => string;
  /** Narrative blocks of the latest report (ESEF only). */
  textBlocks: Array<{ concept: string; text: string }>;
  textUrl: string | null;
  quarters: boolean;
}

async function getJson(f: FinFetch, url: string, headers: Record<string, string>): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await f(url, { headers, signal: ac.signal });
    if (!res.ok) throw new SourceError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function pullEdgar(cik: string, opts: { fetchImpl: FinFetch; userAgent: string; pace: () => Promise<void> }): Promise<PulledEntity> {
  if (!/@/.test(opts.userAgent)) throw new SourceError('SEC_USER_AGENT must name the app and a contact email', 0);
  const id = padCik(cik);
  await opts.pace();
  const cf = (await getJson(opts.fetchImpl, `https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`, { 'User-Agent': opts.userAgent, Accept: 'application/json' })) as CompanyFacts;
  const cikNum = String(Number(id));
  return {
    source: 'sec_edgar',
    entityId: id,
    entityName: cf.entityName,
    facts: factsFromCompanyFacts(cf),
    urlFor: () => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNum}&type=&dateb=&owner=include&count=40`,
    textBlocks: [],
    textUrl: null,
    quarters: true,
  };
}

interface XbrlOrgFiling {
  attributes: { period_end: string; date_added: string; json_url: string | null; report_url: string | null; error_count?: number | null };
}

const XBRL_ORG = 'https://filings.xbrl.org';

export async function pullEsef(lei: string, opts: { fetchImpl: FinFetch; userAgent: string; pace: () => Promise<void> }): Promise<PulledEntity> {
  const headers = { 'User-Agent': opts.userAgent, Accept: 'application/json' };
  await opts.pace();
  const ent = (await getJson(opts.fetchImpl, `${XBRL_ORG}/api/entities/${encodeURIComponent(lei)}`, headers)) as { data?: { attributes?: { name?: string } } };
  const entityName = ent.data?.attributes?.name ?? '';
  await opts.pace();
  const list = (await getJson(opts.fetchImpl, `${XBRL_ORG}/api/entities/${encodeURIComponent(lei)}/filings?sort=-period_end&page%5Bsize%5D=12`, headers)) as { data?: XbrlOrgFiling[] };
  // One filing per period end: the newest upload with a JSON rendering.
  const byEnd = new Map<string, XbrlOrgFiling['attributes']>();
  for (const f of list.data ?? []) {
    const a = f.attributes;
    if (!a.json_url) continue;
    const have = byEnd.get(a.period_end);
    if (!have || a.date_added > have.date_added) byEnd.set(a.period_end, a);
  }
  const ends = [...byEnd.keys()].sort().reverse();
  // Each report carries the year before as comparatives: latest + two years back covers four years.
  const pick = [ends[0], ends[2] ?? ends[1]].filter((x, i, arr): x is string => Boolean(x) && arr.indexOf(x) === i);
  const facts: RawFact[] = [];
  const urls = new Map<string, string>();
  let textBlocks: Array<{ concept: string; text: string }> = [];
  let textUrl: string | null = null;
  for (const [i, end] of pick.entries()) {
    const a = byEnd.get(end)!;
    await opts.pace();
    const doc = (await getJson(opts.fetchImpl, `${XBRL_ORG}${a.json_url}`, headers)) as XbrlJson;
    const filed = a.date_added ? new Date(`${a.date_added.replace(' ', 'T').slice(0, 19)}Z`).toISOString() : null;
    for (const f of factsFromXbrlJson(doc, filed)) facts.push(f);
    const viewer = a.report_url ? `${XBRL_ORG}${a.report_url}` : `${XBRL_ORG}/filing/${encodeURIComponent(lei)}`;
    urls.set(end, viewer);
    if (i === 0) {
      textBlocks = textBlocksFromXbrlJson(doc);
      textUrl = viewer;
    }
  }
  const year = (d: string) => d.slice(0, 4);
  return {
    source: 'esef',
    entityId: lei,
    entityName,
    facts,
    // A comparative year links to its own report when we have it, else to the report that carried it.
    urlFor: (pe) => urls.get(pe) ?? [...urls.entries()].find(([e]) => Number(year(e)) === Number(year(pe)) + 1)?.[1] ?? urls.values().next().value ?? `${XBRL_ORG}/`,
    textBlocks,
    textUrl,
    quarters: false,
  };
}
