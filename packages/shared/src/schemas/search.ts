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
});
export type SearchResponse = z.infer<typeof SearchResponse>;
