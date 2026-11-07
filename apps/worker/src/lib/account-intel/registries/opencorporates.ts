/**
 * OpenCorporates (slice 12), optional. Only used when OPENCORPORATES_API_TOKEN
 * is set, under the token holder's OpenCorporates licence (attribution
 * required, ODbL share-alike for the open tier). Reads the company record
 * only, never officers.
 */
import { webUrl, type IntelClient } from '../http.js';
import type { RegistryFact } from './types.js';

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Status, incorporation date and registered type from one company record. */
export function openCorporatesFacts(body: string): { facts: RegistryFact[]; url: string | null } {
  const c = obj(obj(obj(JSON.parse(body)).results).company);
  const facts: RegistryFact[] = [];
  const status = str(c.current_status);
  if (status) facts.push({ label: 'Status', value: status });
  const inc = str(c.incorporation_date);
  if (inc) facts.push({ label: 'Incorporated', value: inc });
  const type = str(c.company_type);
  if (type) facts.push({ label: 'Company type', value: type });
  return { facts, url: webUrl(str(c.opencorporates_url)) };
}

/** Fetch one company by jurisdiction and registry number. */
export async function fetchOpenCorporates(client: IntelClient, token: string, jurisdiction: string, number: string) {
  const url = `https://api.opencorporates.com/v0.4/companies/${encodeURIComponent(jurisdiction.toLowerCase())}/${encodeURIComponent(number)}?api_token=${encodeURIComponent(token)}`;
  return openCorporatesFacts(await client.get(url, { accept: 'application/json' }));
}
