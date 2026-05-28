/**
 * sales-intelligence.helpers.ts — Constants, interfaces, and pure helper functions.
 *
 * WHY separate: these are shared across the charts, summary, and service layers with
 * no dependency on Prisma, Fastify, or each other. Leaf node — isolating them here
 * allows independent testing and keeps every dependent module under 400 lines.
 *
 * Import DAG: no local sibling imports — leaf node.
 */
import type { SalesRankRow, SourceAttribution } from '@bidstack/shared';
import { asRecord, normalizeCountry, normalizeName } from '@bidstack/shared';

/* ─── Constants ─── */

export const SALES_CURRENCY = 'CAD';
export const QUOTATION_STATES = new Set(['draft', 'sent']);
export const ORDER_STATES = new Set(['confirmed', 'done', 'closed_won']);

export const COUNTRY_META: Record<string, { name: string }> = {
  CA: { name: 'Canada' },
  US: { name: 'United States' },
  FR: { name: 'France' },
  ES: { name: 'Spain' },
  DE: { name: 'Germany' },
  PT: { name: 'Portugal' },
  NO: { name: 'Norway' },
};

export const CUSTOMER_COUNTRY: Record<string, string> = {
  Mantu: 'FR',
  'CI Financial': 'CA',
  'Logistec Corporation': 'CA',
  'Rush University System for Health': 'US',
  MAPFRE: 'ES',
  MAHLE: 'DE',
  Aritzia: 'CA',
  NOS: 'PT',
  'DNB Bank': 'NO',
};

/* ─── Interfaces ─── */

export interface SalesOrderRow {
  id: string;
  number: string;
  state: string;
  customerName: string;
  countryCode: string | null;
  currency: string;
  totalMicros: bigint | number;
  orderDate: Date;
  confirmedAt: Date | null;
  salespersonName: string | null;
}

export interface ProductRollupRow {
  product: string;
  category: string | null;
  orderCount: number;
  revenueMicros: bigint | number;
  currencyCode: string | null;
}

/* ─── Math / aggregation utilities ─── */

export function sumMicros(rows: SalesRankRow[]): number {
  return rows.reduce((sum, row) => sum + row.revenueMicros, 0);
}

export function sortByRevenue(rows: SalesRankRow[]): SalesRankRow[] {
  return [...rows].sort((a, b) => b.revenueMicros - a.revenueMicros);
}

/* ─── Classification / normalization helpers ─── */

export function customerCountry(customer: string): string | null {
  return CUSTOMER_COUNTRY[customer] ?? null;
}

export function attribution(
  fetchedAt: string,
  input: {
    source: string;
    label: string;
    confidence: number;
    providerMetadata: Record<string, unknown>;
  },
): SourceAttribution {
  return {
    source: input.source,
    label: input.label,
    sourceUrl: null,
    fetchedAt,
    confidence: input.confidence,
    providerMetadata: input.providerMetadata,
  };
}

export function classifyProduct(
  name: string,
  industry: string | null,
): { product: string; category: string } {
  const text = `${name} ${industry ?? ''}`.toLowerCase();
  if (text.includes('soc') || text.includes('security') || text.includes('cyber')) {
    return { product: 'Managed SOC & Compliance', category: 'Cybersecurity' };
  }
  if (text.includes('identity') || text.includes('access')) {
    return { product: 'Identity Governance Accelerator', category: 'Identity & Access' };
  }
  if (text.includes('endpoint')) {
    return { product: 'Endpoint Refresh Program', category: 'Endpoint Management' };
  }
  if (text.includes('ehr') || text.includes('cloud') || text.includes('landing zone')) {
    return { product: 'Cloud Migration Factory', category: 'Cloud & Infrastructure' };
  }
  if (text.includes('ot/it') || text.includes('manufacturing') || text.includes('plant')) {
    return { product: 'Industrial IT Assessment', category: 'Industrial Technology' };
  }
  if (text.includes('msp') || text.includes('modernization')) {
    return { product: 'Managed IT Modernization', category: 'Managed Services' };
  }
  return { product: 'Presales Advisory Pack', category: 'Consulting' };
}

export function countryMapFromEnrichments(
  rows: Array<{
    legalName: string;
    tradeName: string | null;
    normalizedName: string;
    providerMetadata: unknown;
  }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const metadata = asRecord(row.providerMetadata);
    const country = normalizeCountry(
      typeof metadata.country === 'string' ? metadata.country : null,
    );
    if (!country) continue;
    map.set(normalizeName(row.legalName), country);
    if (row.tradeName) map.set(normalizeName(row.tradeName), country);
    map.set(normalizeName(row.normalizedName), country);
  }
  return map;
}
