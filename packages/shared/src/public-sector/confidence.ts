/** Source tiers from spec 3.6. */
export const SOURCE_TIER = {
  officialApi: 1,
  officialBulk: 1,
  officialOcds: 0.95,
  thirdParty: 0.7,
} as const;

/**
 * Computed confidence in basis points (never model-asserted): source tier
 * times the share of required fields present, halved for rows the source
 * itself excludes from official figures. Freshness and cross-source agreement
 * are applied later, where records from several sources meet.
 */
export function computeConfidenceBps(opts: {
  tier: number;
  required: readonly unknown[];
  excludedFromOfficial?: boolean;
}): number {
  const present = opts.required.filter((v) => v !== null && v !== undefined && v !== '').length;
  const completeness = opts.required.length === 0 ? 1 : present / opts.required.length;
  const penalty = opts.excludedFromOfficial ? 0.5 : 1;
  return Math.max(0, Math.min(10_000, Math.round(10_000 * opts.tier * completeness * penalty)));
}
