/**
 * UK Companies House company profile (slice 12). Public Data API, free, needs
 * COMPANIES_HOUSE_API_KEY. Officer and PSC endpoints are never called: only
 * the company profile, which has no personal data.
 */
import { COMPANIES_HOUSE_API, normaliseCompanyNumber } from '../../watchdog/companies-house.js';
import type { IntelClient } from '../http.js';
import type { RegistryFact } from './types.js';

/** Public page a human can open for the company. */
export const companiesHousePage = (n: string) => `https://find-and-update.company-information.service.gov.uk/company/${normaliseCompanyNumber(n)}`;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Status, incorporation date, SIC codes and last accounts as dated facts. */
export function companiesHouseProfileFacts(p: Record<string, unknown>): RegistryFact[] {
  const facts: RegistryFact[] = [];
  const status = str(p.company_status);
  if (status) facts.push({ label: 'Status', value: status.charAt(0).toUpperCase() + status.slice(1) });
  const created = str(p.date_of_creation);
  if (created) facts.push({ label: 'Incorporated', value: created });
  const sic = Array.isArray(p.sic_codes) ? p.sic_codes.filter((x): x is string => typeof x === 'string') : [];
  if (sic.length) facts.push({ label: 'SIC codes', value: sic.join(', ') });
  const last = obj(obj(p.accounts).last_accounts);
  const to = str(last.made_up_to);
  if (to) {
    const type = str(last.type);
    facts.push({ label: 'Last accounts', value: `${type ? `${type.charAt(0).toUpperCase()}${type.slice(1)} accounts` : 'Accounts'} to ${to}` });
  }
  return facts;
}

/** Fetch one company profile. */
export async function fetchCompaniesHouseProfile(client: IntelClient, apiKey: string, companyNumber: string): Promise<{ facts: RegistryFact[]; name: string | null; url: string }> {
  const n = normaliseCompanyNumber(companyNumber);
  const body = await client.get(`${COMPANIES_HOUSE_API}/company/${n}`, { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` }, accept: 'application/json' });
  const p = JSON.parse(body) as Record<string, unknown>;
  return { facts: companiesHouseProfileFacts(p), name: str(p.company_name), url: companiesHousePage(n) };
}
