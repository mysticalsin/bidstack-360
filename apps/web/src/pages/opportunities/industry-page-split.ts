/** One bid on the opportunities page. `value` is major units, EUR at rest. */
export interface PageIndustryBid {
  industry: string | null;
  value: number;
  probability: number;
}

export interface PageIndustrySlice {
  key: string;
  label: string;
  opportunityCount: number;
  totalValueMicros: number;
  avgProbability: number;
  ownerNames: string[];
}

export interface PageIndustrySplit {
  items: PageIndustrySlice[];
  totalSegments: number;
  totalValueMicros: number;
  totalOpportunities: number;
}

const UNSPECIFIED = 'Unspecified';

/** Major units to micros, the same scale as the territory industry aggregate. */
function unitsToMicros(units: number): number {
  return Math.round(units * 1_000_000);
}

/**
 * Industry split of the rows on this page.
 *
 * The territory aggregate is every open bid in the book. A stage, due, or
 * search filter must not reuse that total. A blank industry is Unspecified,
 * the same bucket as the SQL COALESCE, so those bids stay in the split.
 */
export function industrySplitFromPage(rows: readonly PageIndustryBid[]): PageIndustrySplit {
  const by = new Map<string, { count: number; units: number; probability: number }>();
  for (const row of rows) {
    const key = row.industry?.trim() || UNSPECIFIED;
    const cur = by.get(key) ?? { count: 0, units: 0, probability: 0 };
    cur.count += 1;
    cur.units += row.value;
    cur.probability += row.probability;
    by.set(key, cur);
  }
  const items = [...by.entries()]
    .map(([key, bucket]) => ({
      key,
      label: key,
      opportunityCount: bucket.count,
      totalValueMicros: unitsToMicros(bucket.units),
      avgProbability: bucket.count === 0 ? 0 : Math.round(bucket.probability / bucket.count),
      ownerNames: [] as string[],
    }))
    .sort((a, b) => b.totalValueMicros - a.totalValueMicros || a.label.localeCompare(b.label));
  return {
    items,
    totalSegments: items.length,
    totalValueMicros: items.reduce((sum, item) => sum + item.totalValueMicros, 0),
    totalOpportunities: rows.length,
  };
}
