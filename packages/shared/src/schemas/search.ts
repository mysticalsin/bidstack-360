import { z } from 'zod';

export const SearchResultType = z.enum([
  'opportunity',
  'lead',
  'contact',
  'company',
  'task',
  'note',
  // Bid-piloting entities surfaced by global search (proposals, extracted RFP
  // requirements, and reusable references / case-study stories).
  'proposal',
  'rfp_requirement',
  'reference',
  // 'sales_order' retained for tolerance of any persisted/cached value; the
  // module was removed and nothing emits it.
  'sales_order',
]);
export type SearchResultType = z.infer<typeof SearchResultType>;

export const SearchResult = z.object({
  type: SearchResultType,
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  url: z.string(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({
  items: z.array(SearchResult),
  /**
   * True when a per-type read kept one row past the limit, or the merged
   * list was longer than the page. `items` is that page, not every match.
   * This is not a result total.
   */
  pageContinues: z.boolean(),
  /**
   * Types whose drawn rows are not every match of that type. A type is
   * listed when its probe row was dropped, or the merged page cut a loaded
   * row of that type. Not a match total.
   */
  continuedTypes: z.array(SearchResultType),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/**
 * Ranked rows after each type has already dropped its probe row.
 * `probedTypes` are the types whose extra row existed. A merged page that
 * cuts a loaded row adds that type. The cut row is not returned, and neither
 * list is a match total.
 */
export function searchPageSlice<T extends { type: string }>(
  ranked: readonly T[],
  totalCap: number,
  probedTypes: readonly string[],
): { items: T[]; pageContinues: boolean; continuedTypes: string[] } {
  const continued = new Set(probedTypes);
  const cut = ranked.length > totalCap;
  const items = cut ? ranked.slice(0, totalCap) : [...ranked];
  if (cut) {
    const drawn = new Map<string, number>();
    for (const item of items) drawn.set(item.type, (drawn.get(item.type) ?? 0) + 1);
    const loaded = new Map<string, number>();
    for (const item of ranked) loaded.set(item.type, (loaded.get(item.type) ?? 0) + 1);
    for (const [type, count] of loaded) {
      if ((drawn.get(type) ?? 0) < count) continued.add(type);
    }
  }
  return {
    items,
    pageContinues: cut || continued.size > 0,
    continuedTypes: [...continued],
  };
}
