// Sourced company figures (slice 22): manual overrides with their source and
// the Wikidata revenue cached by the open enrichment, read for one company.
import { prisma } from '@bidstack/db';
import { industryLabel, type FigureOrigin, type FigureProvenance, type IntelRegistryFact } from '@bidstack/shared';

import { normalizeName } from '../crm/dashboard.utils.js';

export interface SourcedOverride {
  value: unknown;
  sourceUrl: string | null;
  sourceLabel: string | null;
  updatedAt: Date;
}

export interface WikidataRevenue {
  amount: number;
  currency: string;
  pointInTime: string;
  year: number;
  sourceUrl: string;
}

const OVERRIDE_KEYS = ['employeeCount', 'annualRevenueMicros', 'registryId', 'registryJurisdiction'] as const;
type OverrideKey = (typeof OVERRIDE_KEYS)[number];

const PROVIDER_LABEL: Record<string, string> = { apollo: 'Apollo', seamless: 'Seamless.AI' };

export const providerLabel = (source: string | null | undefined): string =>
  source ? (PROVIDER_LABEL[source] ?? source.charAt(0).toUpperCase() + source.slice(1)) : 'Data provider';

export const manualOrigin = (o: SourcedOverride): FigureOrigin => (o.sourceUrl ? 'manual_sourced' : 'manual');

export const manualProvenance = (o: SourcedOverride): FigureProvenance => ({
  origin: manualOrigin(o),
  label: o.sourceLabel ?? 'Manual',
  year: String(o.updatedAt.getUTCFullYear()),
  url: o.sourceUrl,
});

function readWikidataRevenue(providerMetadata: unknown): WikidataRevenue | null {
  const meta = providerMetadata as { openCompanyProfile?: { revenue?: Partial<WikidataRevenue> | null } | null } | null;
  const r = meta?.openCompanyProfile?.revenue;
  if (!r || typeof r.amount !== 'number' || typeof r.currency !== 'string' || typeof r.year !== 'number' || typeof r.sourceUrl !== 'string') return null;
  return { amount: r.amount, currency: r.currency, pointInTime: typeof r.pointInTime === 'string' ? r.pointInTime : String(r.year), year: r.year, sourceUrl: r.sourceUrl };
}

const enc = encodeURIComponent;
/** Public register page per identifier the account intel run matched. */
const IDENTIFIER_ROWS: Array<{ field: 'lei' | 'frSiren' | 'companiesHouseNumber' | 'brregOrgNumber' | 'secCik'; label: string; source: string; url: (v: string) => string }> = [
  { field: 'lei', label: 'LEI', source: 'GLEIF', url: (v) => `https://search.gleif.org/#/record/${enc(v)}` },
  { field: 'frSiren', label: 'SIREN', source: 'Annuaire des entreprises', url: (v) => `https://annuaire-entreprises.data.gouv.fr/entreprise/${enc(v)}` },
  { field: 'companiesHouseNumber', label: 'Company number', source: 'Companies House', url: (v) => `https://find-and-update.company-information.service.gov.uk/company/${enc(v.toUpperCase().padStart(8, '0'))}` },
  { field: 'brregOrgNumber', label: 'Organisation number', source: 'Brønnøysund', url: (v) => `https://virksomhet.brreg.no/nb/oppslag/enheter/${enc(v)}` },
  { field: 'secCik', label: 'SEC CIK', source: 'SEC EDGAR', url: (v) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${enc(v)}` },
];

const CODE_LABEL_RE = /industry|activity|nace|naf|sic/i;

/**
 * Registry block rows: the user's registration number and jurisdiction (with
 * their source), then identifiers already matched, then the stored facts.
 * Industry-style facts never show a bare one or two character code.
 */
export async function registryRows(orgId: string, companyId: string, companyName: string, facts: IntelRegistryFact[]): Promise<IntelRegistryFact[]> {
  const [{ overrides }, subject] = await Promise.all([
    loadSourcedExtras(orgId, companyName),
    prisma.accountWatchSubject.findFirst({
      where: { orgId, companyId },
      select: { lei: true, frSiren: true, companiesHouseNumber: true, brregOrgNumber: true, secCik: true, updatedAt: true },
    }),
  ]);
  const out: IntelRegistryFact[] = [];
  const manual = (fieldKey: 'registryId' | 'registryJurisdiction', label: string) => {
    const o = overrides[fieldKey];
    if (!o || typeof o.value !== 'string') return;
    out.push({ label, value: o.value, source: o.sourceLabel ?? 'Manual', sourceUrl: o.sourceUrl, fetchedAt: o.updatedAt.toISOString(), fieldKey });
  };
  manual('registryId', 'Registration number');
  manual('registryJurisdiction', 'Jurisdiction');
  if (subject) {
    for (const r of IDENTIFIER_ROWS) {
      const v = subject[r.field];
      if (v) out.push({ label: r.label, value: v, source: r.source, sourceUrl: r.url(v), fetchedAt: subject.updatedAt.toISOString() });
    }
  }
  for (const f of facts) {
    if (CODE_LABEL_RE.test(f.label) && f.value.trim().length <= 2) {
      const label = industryLabel(f.value);
      if (!label) continue;
      out.push({ ...f, value: `${f.value.trim()} ${label}` });
    } else out.push(f);
  }
  return out;
}

/** Overrides and Wikidata revenue for one company, keyed the way the cockpit keys them (normalised name). */
export async function loadSourcedExtras(
  orgId: string,
  companyName: string,
): Promise<{ overrides: Partial<Record<OverrideKey, SourcedOverride>>; wikidataRevenue: WikidataRevenue | null }> {
  const key = normalizeName(companyName);
  const [rows, enrichment] = await Promise.all([
    prisma.companyFieldOverride.findMany({
      where: { orgId, companyKey: key, fieldKey: { in: [...OVERRIDE_KEYS] } },
      select: { fieldKey: true, value: true, sourceUrl: true, sourceLabel: true, updatedAt: true },
      take: OVERRIDE_KEYS.length,
    }),
    prisma.companyEnrichment.findUnique({
      where: { orgId_normalizedName: { orgId, normalizedName: key } },
      select: { providerMetadata: true },
    }),
  ]);
  const overrides: Partial<Record<OverrideKey, SourcedOverride>> = {};
  for (const r of rows) overrides[r.fieldKey as OverrideKey] = { value: r.value, sourceUrl: r.sourceUrl, sourceLabel: r.sourceLabel, updatedAt: r.updatedAt };
  return { overrides, wikidataRevenue: readWikidataRevenue(enrichment?.providerMetadata) };
}
