/**
 * Tabs the search page can actually filter. Kept beside the page so a new
 * search type has to be named here before a result row can be grouped.
 *
 * `sales_order` is intentionally absent. The module was removed and the API
 * only still tolerates the value on a stale payload. It is not a tab, and
 * `searchPageRows` drops it so a cached hit cannot draw a deleted route.
 */
export const SEARCH_PAGE_TYPE_KEYS = [
  'opportunity',
  'lead',
  'contact',
  'company',
  'task',
  'note',
  'proposal',
  'rfp_requirement',
  'reference',
] as const;

export type SearchPageTypeKey = (typeof SEARCH_PAGE_TYPE_KEYS)[number];
export type SearchPageTabKey = 'all' | SearchPageTypeKey;

const SEARCH_PAGE_TYPE_SET: ReadonlySet<string> = new Set(SEARCH_PAGE_TYPE_KEYS);

export function isSearchPageType(type: string): type is SearchPageTypeKey {
  return SEARCH_PAGE_TYPE_SET.has(type);
}

/** URL `type` values outside the live tab list, including `sales_order`, read as All. */
export function searchPageTab(requested: string | null): SearchPageTabKey {
  if (requested && SEARCH_PAGE_TYPE_SET.has(requested)) return requested as SearchPageTypeKey;
  return 'all';
}

/** Rows the page draws. A stale `sales_order` hit is not a result. */
export function searchPageRows<T extends { type: string }>(items: readonly T[] | undefined): T[] {
  if (!items) return [];
  return items.filter((item) => item.type !== 'sales_order');
}
