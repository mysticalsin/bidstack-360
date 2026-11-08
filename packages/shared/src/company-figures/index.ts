/**
 * Sourced company figures (slice 22): one precedence rule for revenue,
 * employees and registry identifiers, plus readable industry labels.
 * Pure data and functions, safe for the web bundle.
 */
import { z } from 'zod';

/** Where a figure came from, strongest first in FIGURE_PRECEDENCE. */
export const FigureOrigin = z.enum(['filed', 'manual_sourced', 'wikidata', 'manual', 'provider', 'crm']);
export type FigureOrigin = z.infer<typeof FigureOrigin>;

/**
 * Filed statements beat everything. A manual value the user backed with a
 * source link beats Wikidata; a manual value without a source does not.
 */
export const FIGURE_PRECEDENCE: readonly FigureOrigin[] = ['filed', 'manual_sourced', 'wikidata', 'manual', 'provider', 'crm'];

/** The visible source chip under a figure: label, year and link. */
export const FigureProvenance = z.object({
  origin: FigureOrigin,
  label: z.string(),
  year: z.string().nullable(),
  url: z.string().nullable(),
  /** True for a figure nobody has checked against a public source (the CRM record). */
  unverified: z.boolean().optional(),
});
export type FigureProvenance = z.infer<typeof FigureProvenance>;

/** The strongest candidate by FIGURE_PRECEDENCE; falsy entries are skipped. */
export function pickFigure<T extends { origin: FigureOrigin }>(candidates: ReadonlyArray<T | null | undefined | false>): T | null {
  let best: T | null = null;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || FIGURE_PRECEDENCE.indexOf(c.origin) < FIGURE_PRECEDENCE.indexOf(best.origin)) best = c;
  }
  return best;
}

/** Field keys a user may override on a company, with provenance. */
export const COMPANY_FIELD_OVERRIDE_KEYS = ['industry', 'employeeCount', 'annualRevenueMicros', 'registryId', 'registryJurisdiction'] as const;
export type CompanyFieldOverrideKey = (typeof COMPANY_FIELD_OVERRIDE_KEYS)[number];

/** True for an absolute http or https URL; anything else is refused as a source. */
export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Short chip text: "SEC EDGAR · FY2025", "CRM record · unverified", or the label alone. */
export function provenanceText(p: Pick<FigureProvenance, 'label' | 'year'> & { unverified?: boolean }): string {
  return [p.label, p.year, p.unverified ? 'unverified' : null].filter(Boolean).join(' · ');
}

/** Currencies a manual revenue figure can be entered in (ISO 4217). */
export const MANUAL_REVENUE_CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'NOK', 'SEK', 'DKK', 'BRL', 'AUD', 'JPY', 'PLN'] as const;
export type ManualRevenueCurrency = (typeof MANUAL_REVENUE_CURRENCIES)[number];

const NACE_SECTIONS: Record<string, string> = {
  A: 'Agriculture, forestry and fishing',
  B: 'Mining and quarrying',
  C: 'Manufacturing',
  D: 'Electricity, gas and steam supply',
  E: 'Water supply and waste management',
  F: 'Construction',
  G: 'Wholesale and retail trade',
  H: 'Transportation and storage',
  I: 'Accommodation and food services',
  J: 'Information and communication',
  K: 'Financial and insurance activities',
  L: 'Real estate activities',
  M: 'Professional, scientific and technical activities',
  N: 'Administrative and support services',
  O: 'Public administration and defence',
  P: 'Education',
  Q: 'Human health and social work',
  R: 'Arts, entertainment and recreation',
  S: 'Other service activities',
  T: 'Households as employers',
  U: 'Extraterritorial organisations',
};

const NAICS_SECTORS: Record<string, string> = {
  '11': 'Agriculture, forestry, fishing and hunting',
  '21': 'Mining, quarrying, and oil and gas extraction',
  '22': 'Utilities',
  '23': 'Construction',
  '31': 'Manufacturing',
  '32': 'Manufacturing',
  '33': 'Manufacturing',
  '42': 'Wholesale trade',
  '44': 'Retail trade',
  '45': 'Retail trade',
  '48': 'Transportation and warehousing',
  '49': 'Transportation and warehousing',
  '51': 'Information',
  '52': 'Finance and insurance',
  '53': 'Real estate and rental and leasing',
  '54': 'Professional, scientific, and technical services',
  '55': 'Management of companies and enterprises',
  '56': 'Administrative and support services',
  '61': 'Educational services',
  '62': 'Health care and social assistance',
  '71': 'Arts, entertainment, and recreation',
  '72': 'Accommodation and food services',
  '81': 'Other services',
  '92': 'Public administration',
};

/**
 * Readable industry text, or null when only an unreadable code is known.
 * A bare letter is read as a NACE section (EU registries) and two digits as
 * a NAICS sector (US data providers); any other one or two character value
 * is dropped rather than shown as a cryptic code.
 */
export function industryLabel(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^wikidata industry q\d+$/i.test(v)) return null;
  if (/^[A-Ua-u]$/.test(v)) return NACE_SECTIONS[v.toUpperCase()] ?? null;
  if (/^\d{2}$/.test(v)) return NAICS_SECTORS[v] ?? null;
  if (v.length <= 2) return null;
  const human = v.includes('_') ? v.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() : v;
  return human.charAt(0).toUpperCase() + human.slice(1);
}
