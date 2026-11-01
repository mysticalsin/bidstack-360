/** Accepted and mitigated risks are recorded decisions, not open work. */
export function isOpenRisk(status: string): boolean {
  return status === 'open' || status === 'in_progress';
}

export interface OpenRiskSeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** Open-risk counts from the register. The six cards are the fallback. */
export function severityBucketCounts(
  risks: readonly { severity: string | null }[],
  counted?: OpenRiskSeverityCounts,
): OpenRiskSeverityCounts {
  if (counted) return counted;
  const tally: OpenRiskSeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const risk of risks) {
    if (
      risk.severity === 'critical' ||
      risk.severity === 'high' ||
      risk.severity === 'medium' ||
      risk.severity === 'low'
    ) {
      tally[risk.severity] += 1;
    }
  }
  return tally;
}

/** Headline open-risk figures. A card of six is not the account book. */
export function openRiskHeadline(input: {
  risks: readonly { status: string; severity: string | null }[];
  openRiskCount?: number;
  openRiskSeverity?: OpenRiskSeverityCounts;
}): { total: number; high: number; spark: [number, number, number, number] } {
  const shown = input.risks.filter((risk) => isOpenRisk(risk.status));
  const buckets = input.openRiskSeverity ?? severityBucketCounts(shown);
  return {
    total: input.openRiskCount ?? shown.length,
    high: buckets.critical + buckets.high,
    spark: [buckets.low, buckets.medium, buckets.high, buckets.critical],
  };
}
