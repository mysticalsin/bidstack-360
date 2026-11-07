/**
 * GLEIF LEI matching (slice 12). The Global LEI Index is open data under
 * CC0, no key needed. An LEI is adopted only when exactly one active record
 * matches the account's legal name and country; the match is kept as
 * evidence so a person can check it.
 */
import type { IntelClient } from '../http.js';
import { normaliseLegalName } from './types.js';

const API = 'https://api.gleif.org/api/v1/lei-records';

/** A trimmed LEI record. */
export interface LeiRecord {
  lei: string;
  legalName: string;
  country: string | null;
  registeredAs: string | null;
  registeredAt: string | null;
  status: string | null;
}

/** Fuzzy legal-name search, filtered by country when known. */
export function gleifSearchUrl(name: string, country: string | null): string {
  const p = new URLSearchParams({ 'filter[fulltext]': name, 'page[size]': '5' });
  if (country) p.set('filter[entity.legalAddress.country]', country.toUpperCase());
  return `${API}?${p.toString()}`;
}

/** Human page for one LEI. */
export const gleifRecordPage = (lei: string) => `https://search.gleif.org/#/record/${lei}`;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Parse an lei-records answer. */
export function parseGleifRecords(body: string): LeiRecord[] {
  const raw = obj(JSON.parse(body)).data;
  const data = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return data.map(obj).flatMap((d) => {
    const a = obj(d.attributes);
    const e = obj(a.entity);
    const lei = str(a.lei) ?? str(d.id);
    const legalName = str(obj(e.legalName).name);
    if (!lei || !legalName) return [];
    const reg = str(e.registeredAs);
    return [{ lei, legalName, country: str(obj(e.legalAddress).country), registeredAs: reg ? reg.replace(/\s+/g, '') : null, registeredAt: str(obj(e.registeredAt).id), status: str(e.status) }];
  });
}

/** Exactly one active record whose normalised legal name equals the account name. */
export function uniqueLeiMatch(records: LeiRecord[], name: string, country: string | null): LeiRecord | null {
  const want = normaliseLegalName(name);
  if (!want) return null;
  const hits = records.filter((r) => (r.status ?? 'ACTIVE') === 'ACTIVE' && normaliseLegalName(r.legalName) === want && (!country || !r.country || r.country.toUpperCase() === country.toUpperCase()));
  return hits.length === 1 ? hits[0]! : null;
}

/** Read one LEI record (for an LEI already on file). */
export async function readLei(client: IntelClient, lei: string): Promise<LeiRecord | null> {
  return parseGleifRecords(await client.get(`${API}/${encodeURIComponent(lei)}`, { accept: 'application/vnd.api+json' }))[0] ?? null;
}

/** Search GLEIF and return the unique match, if any. */
export async function matchLei(client: IntelClient, name: string, country: string | null): Promise<{ record: LeiRecord | null; url: string; candidates: number }> {
  const url = gleifSearchUrl(name, country);
  const records = parseGleifRecords(await client.get(url, { accept: 'application/vnd.api+json' }));
  return { record: uniqueLeiMatch(records, name, country), url, candidates: records.length };
}
