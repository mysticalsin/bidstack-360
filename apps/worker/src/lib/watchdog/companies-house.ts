import { classifyCompaniesHouseFiling } from './classify.js';
import type { FetchLike, RawWatchEvent } from './edgar.js';

/**
 * Companies House public data API: filing history for one company.
 * Docs: https://developer-specs.company-information.service.gov.uk/
 * Auth is HTTP Basic with the API key as the username and an empty password.
 * The key comes from COMPANIES_HOUSE_API_KEY and is never logged or returned.
 */
export const COMPANIES_HOUSE_API = 'https://api.company-information.service.gov.uk';
const PUBLIC_SITE = 'https://find-and-update.company-information.service.gov.uk';

/** Subset of GET /company/{number}/filing-history. */
export interface CompaniesHouseFilingHistory {
  items?: Array<{
    transaction_id: string;
    type: string;
    category?: string;
    subcategory?: string;
    date: string; // YYYY-MM-DD
    description?: string;
    description_values?: Record<string, string>;
    links?: { self?: string; document_metadata?: string };
  }>;
}

/** Normalise a company number: CH numbers are 8 chars, zero-padded when numeric. */
export function normaliseCompanyNumber(n: string): string {
  const s = n.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{1,8}$/.test(s)) throw new Error('Invalid Companies House number');
  return /^\d+$/.test(s) ? s.padStart(8, '0') : s;
}

export function companiesHouseFilingHistoryUrl(companyNumber: string, itemsPerPage = 50): string {
  return `${COMPANIES_HOUSE_API}/company/${encodeURIComponent(normaliseCompanyNumber(companyNumber))}/filing-history?items_per_page=${itemsPerPage}`;
}

/** "appoint-person-director-company-with-name-date" → "Appoint person director company with name date". */
function humanise(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const s = code.replace(/-/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normaliseCompaniesHouseFilings(
  companyNumber: string,
  companyName: string,
  data: CompaniesHouseFilingHistory,
  since?: Date,
): RawWatchEvent[] {
  const num = normaliseCompanyNumber(companyNumber);
  const out: RawWatchEvent[] = [];
  for (const it of data.items ?? []) {
    if (!it.transaction_id) continue; // no stable id = cannot dedupe; never guess one
    const filed = new Date(`${it.date}T00:00:00Z`);
    if (Number.isNaN(filed.getTime())) continue;
    if (since && filed < since) continue;
    const c = classifyCompaniesHouseFiling(it.type, it.category ?? '');
    if (c.kind === 'FILING' && c.severity <= 1) continue; // routine noise (CS01, PSC…)
    const what = humanise(it.description, `Filing ${it.type}`);
    const officer = it.description_values?.officer_name;
    out.push({
      ...c,
      source: 'companies_house',
      externalId: it.transaction_id,
      occurredAt: filed,
      title: `${companyName}: ${what}${officer ? ` (${officer})` : ''}`,
      sourceUrl: `${PUBLIC_SITE}/company/${num}/filing-history/${encodeURIComponent(it.transaction_id)}`,
      summary: `${companyName} filed ${it.type} at Companies House on ${it.date}. ${c.rationale}`,
      confirmed: true,
      payload: { type: it.type, category: it.category ?? null, subcategory: it.subcategory ?? null, description: it.description ?? null },
    });
  }
  return out;
}

/** Fetch + normalise. 404 = unknown company number (a config error, surfaced as such). */
export async function fetchCompaniesHouseEvents(
  companyNumber: string,
  companyName: string,
  opts: { apiKey: string; since?: Date; fetchImpl?: FetchLike },
): Promise<RawWatchEvent[]> {
  if (!opts.apiKey) throw new Error('COMPANIES_HOUSE_API_KEY is not configured');
  const f = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const auth = `Basic ${Buffer.from(`${opts.apiKey}:`).toString('base64')}`;
  const res = await f(companiesHouseFilingHistoryUrl(companyNumber), { headers: { Authorization: auth, Accept: 'application/json' } });
  if (res.status === 429) throw Object.assign(new Error('Companies House rate limited (429)'), { retryable: true });
  if (res.status === 401) throw new Error('Companies House rejected the API key (401)');
  if (res.status === 404) throw new Error(`Companies House has no company ${normaliseCompanyNumber(companyNumber)} (404)`);
  if (!res.ok) throw new Error(`Companies House filing history HTTP ${res.status}`);
  return normaliseCompaniesHouseFilings(companyNumber, companyName, (await res.json()) as CompaniesHouseFilingHistory, opts.since);
}
