/**
 * France, API Recherche d'entreprises (slice 12). Public service run by the
 * French State (DINUM) under Licence Ouverte 2.0, no key needed. Revenue
 * (chiffre d'affaires) and net income come from the published accounts in
 * the RNE when the company did not opt out of publication. Officer names in
 * the answer are dropped at parse time.
 */
import type { IntelClient } from '../http.js';
import type { RegistryPeriod } from './types.js';

const API = 'https://recherche-entreprises.api.gouv.fr/search';

/** Search URL for one SIREN. */
export const rechercheUrl = (siren: string) => `${API}?q=${encodeURIComponent(siren)}&page=1&per_page=1`;
/** Public page a human can open for the company. */
export const annuairePage = (siren: string) => `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Name, employee band and yearly revenue for the SIREN. */
export function parseRechercheEntreprises(body: string, siren: string): { name: string; employeeBand: string | null; naf: string | null; periods: RegistryPeriod[] } | null {
  const results = (obj(JSON.parse(body)).results as unknown[] | undefined) ?? [];
  const hit = results.map(obj).find((r) => r.siren === siren);
  if (!hit) return null;
  const finances = obj(hit.finances);
  const periods: RegistryPeriod[] = Object.entries(finances)
    .map(([year, v]) => {
      const f = obj(v);
      const metrics: RegistryPeriod['metrics'] = {};
      const ca = num(f.ca);
      const net = num(f.resultat_net);
      if (ca != null) metrics.revenue = { value: ca, concept: 'rne:chiffre_affaires' };
      if (net != null) metrics.netIncome = { value: net, concept: 'rne:resultat_net' };
      return { periodType: 'FY' as const, fiscalYear: Number(year), periodStart: null, periodEnd: `${year}-12-31`, currency: 'EUR', filedAt: null, metrics, sourceUrl: annuairePage(siren) };
    })
    .filter((p) => Number.isFinite(p.fiscalYear) && Object.keys(p.metrics).length > 0)
    .sort((a, b) => b.fiscalYear - a.fiscalYear);
  return {
    name: String(hit.nom_raison_sociale ?? hit.nom_complet ?? ''),
    employeeBand: typeof hit.tranche_effectif_salarie === 'string' ? hit.tranche_effectif_salarie : null,
    naf: typeof hit.activite_principale === 'string' ? hit.activite_principale : null,
    periods,
  };
}

/** Fetch and parse one SIREN. */
export async function fetchFrance(client: IntelClient, siren: string) {
  const s = siren.replace(/\s+/g, '');
  if (!/^\d{9}$/.test(s)) throw new Error('France: SIREN must be 9 digits');
  const url = rechercheUrl(s);
  return { url, parsed: parseRechercheEntreprises(await client.get(url, { accept: 'application/json' }), s) };
}
