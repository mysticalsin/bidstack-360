import type { SourceAttribution } from '@bidstack/shared';

/**
 * Receipts the cockpit attaches when nobody fetched an external source.
 * An opportunity row, a bare CRM record, and a demo seed profile are not
 * attribution. Averaging their confidence printed a percentage on every
 * demo account.
 */
const PLACEHOLDER_ATTRIBUTION_SOURCES = new Set([
  'external_crm',
  'bidstack',
  'bidstack_seed',
  'seed_verified_profile',
]);

export interface DataTrustPosture {
  realSources: SourceAttribution[];
  /** Null when no external receipt is attached. Company confidence is not a substitute. */
  confidence: number | null;
  latestFetch: string | null;
}

export function isPlaceholderAttribution(source: string): boolean {
  return PLACEHOLDER_ATTRIBUTION_SOURCES.has(source);
}

export function dataTrustPosture(sources: SourceAttribution[]): DataTrustPosture {
  const realSources = sources.filter((source) => !isPlaceholderAttribution(source.source));
  let latestFetch: string | null = null;
  let confidenceSum = 0;
  for (const source of realSources) {
    confidenceSum += source.confidence;
    if (!latestFetch || source.fetchedAt > latestFetch) latestFetch = source.fetchedAt;
  }
  return {
    realSources,
    confidence: realSources.length === 0 ? null : confidenceSum / realSources.length,
    latestFetch,
  };
}
