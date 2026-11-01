// Labels for figures that live in stored records but were not measured
// by a live source probe. Callers must not invent a score or print the
// raw payload (including provider names) as if a source was queried.

export type FinancialHonesty = 'unknown' | 'proxy' | 'source not probed';

const PROVIDER_DUMP =
  /crunchbase|linkedin|apollo|edgar|usaspending|tradingview|wikidata|sillage|brandfetch|provider|source/i;

export function financialHonesty(value: unknown): FinancialHonesty {
  if (value == null) return 'unknown';
  if (typeof value === 'number') return Number.isFinite(value) ? 'proxy' : 'unknown';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 'unknown';
    // Objects stringified into the field, or a provider name, are not a figure.
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || PROVIDER_DUMP.test(trimmed)) {
      return 'source not probed';
    }
    return 'proxy';
  }
  return 'source not probed';
}

/** A stored deal probability. Null when the record has no finite number. */
export function recordedProbability(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}
