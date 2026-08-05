// URL state for the Bid/No-Bid decision matrix — ROUND2-ULTRAPLAN Phase 2,
// "the density retarget": every filtered view of a bid surface is a shareable URL.
//
// ── WHAT THE URL CARRIES ────────────────────────────────────────────────────
//   ?opportunityId=…  the subject of the matrix. Pre-existing key, kept spelled
//                     exactly as it was so the two <Link>s in
//                     pages/opportunityDetail/BidScoreCard.tsx:141,157 and every
//                     bookmark already in the wild keep resolving.
//   ?category=…       which slice of the weighted registry the table shows
//                     ('all' = the whole registry, and never appears in the URL).
//   ?sort= &dir=      column order over the 10 weighted criteria
//                     ('' = registry order, which is grouped by category).
//
// ── WHY opportunityId MOVES OFF useSearchParams ─────────────────────────────
// docs/design-system/url-param-audit.md §2 lists `BidNoBidPage.tsx:230,232` as
// one of the five destructive writers: both writes are object-form
// (`setSearchParams({ opportunityId: id })` / `setSearchParams({})`), which
// DROPS every param not named in the literal. Before this change that was
// harmless only because the page owned no other param; the moment `category`
// and `sort` exist, picking a different opportunity would silently wipe the
// view. The audit's conversion rule is explicit — "both writers move together"
// — so the parser lives here beside the list params and the page writes through
// nuqs, which merges instead of replacing.
//
// ── WHY page/pageSize ARE DECLARED BUT NOTHING PAGINATES ────────────────────
// The row set is the criteria registry itself: a fixed 10 rows that is never
// fetched and never sliced. createListSearchParams declares page/pageSize for
// every surface; here they sit at their defaults and `clearOnDefault` keeps
// them out of the query string entirely.

import { parseAsString } from 'nuqs';

import { BID_CRITERIA, type BidCriterionCategory } from '@bidstack/shared';

import { ALL_SEGMENT, createListSearchParams } from '@/lib/table/list-search-params';

/** Query key naming the scored opportunity. Load-bearing: linked from elsewhere. */
export const OPPORTUNITY_ID_KEY = 'opportunityId';

/** Query key naming the visible slice of the criteria registry. */
export const CATEGORY_KEY = 'category';

/**
 * `push`, matching the pre-conversion behaviour the audit recorded: changing the
 * opportunity moves between subjects, so Back should return to the previous one.
 * (Filters and sort stay on `replace` — they refine one view.)
 */
export const opportunityIdParser = parseAsString
  .withOptions({ history: 'push', clearOnDefault: true })
  .withDefault('');

/** Categories in registry order — the segmented filter renders in this order. */
export const CRITERIA_CATEGORIES: readonly BidCriterionCategory[] = [
  'strategic',
  'technical',
  'commercial',
  'risk',
];

/** Sortable columns. `''` (the default) means registry order. */
export type CriteriaSortId = 'criterion' | 'weight' | 'score' | 'contribution';

export const bidNoBidSearchParams = createListSearchParams({
  // Empty default = the registry's own order, which is grouped by category and
  // is the order a reviewer expects to read a decision matrix in. Sorting is an
  // explicit act, so it belongs in the URL rather than in the default view.
  defaultSort: '',
  // Three of the four sortable columns are numeric and are read heaviest-first.
  defaultDir: 'desc',
  pageSize: BID_CRITERIA.length,
  tabId: CATEGORY_KEY,
  defaultTab: ALL_SEGMENT,
});
