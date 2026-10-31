import { classifySecFiling, type Classification } from './classify.js';

/** Normalised event produced by every source adapter. */
export interface RawWatchEvent extends Classification {
  source: string;
  externalId: string;
  occurredAt: Date;
  title: string;
  sourceUrl: string;
  summary: string;
  confirmed: boolean;
  payload: Record<string, unknown>;
}

/** Shape of https://data.sec.gov/submissions/CIK##########.json (subset). */
export interface EdgarSubmissions {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate?: string[];
      form: string[];
      items?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

export const padCik = (cik: string | number) => String(cik).replace(/\D/g, '').padStart(10, '0');

export function edgarSubmissionsUrl(cik: string | number): string {
  return `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
}

/** Normalise EDGAR submissions into watchdog events filed on/after `since`. */
export function normaliseEdgarSubmissions(data: EdgarSubmissions, since?: Date): RawWatchEvent[] {
  const r = data.filings.recent;
  const cikNum = String(Number(data.cik));
  const out: RawWatchEvent[] = [];
  for (let i = 0; i < r.accessionNumber.length; i++) {
    const filed = new Date(`${r.filingDate[i]}T00:00:00Z`);
    if (since && filed < since) continue;
    const form = r.form[i] ?? '';
    const items = (r.items?.[i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const c = classifySecFiling(form, items);
    if (c.kind === 'FILING' && c.severity <= 1) continue; // ignore noise (S-8, 4, 424B…)
    const acc = r.accessionNumber[i]!;
    const doc = r.primaryDocument?.[i];
    const sourceUrl = doc
      ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc.replace(/-/g, '')}/${doc}`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padCik(data.cik)}`;
    const itemTxt = items.length ? ` (items ${items.join(', ')})` : '';
    out.push({
      ...c,
      source: 'sec_edgar',
      externalId: acc,
      occurredAt: filed,
      title: `${data.name}: ${form}${itemTxt}`,
      sourceUrl,
      summary: `${data.name} filed ${form}${itemTxt} on ${r.filingDate[i]}. ${c.rationale}`,
      confirmed: true,
      payload: { form, items, reportDate: r.reportDate?.[i] ?? null, description: r.primaryDocDescription?.[i] ?? null },
    });
  }
  return out;
}

export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

/** Fetch + normalise. SEC fair access requires a descriptive User-Agent. */
export async function fetchEdgarEvents(
  cik: string,
  opts: { since?: Date; userAgent: string; fetchImpl?: FetchLike },
): Promise<RawWatchEvent[]> {
  if (!opts.userAgent || !/@/.test(opts.userAgent)) {
    throw new Error('SEC_USER_AGENT must name the app and a contact email');
  }
  const f = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const res = await f(edgarSubmissionsUrl(cik), { headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' } });
  if (res.status === 429) throw Object.assign(new Error('SEC rate limited (429)'), { retryable: true });
  if (!res.ok) throw new Error(`SEC submissions HTTP ${res.status}`);
  return normaliseEdgarSubmissions((await res.json()) as EdgarSubmissions, opts.since);
}
