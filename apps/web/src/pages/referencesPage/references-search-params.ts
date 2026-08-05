// URL state for the Reference Library (ROUND2-ULTRAPLAN "the density retarget",
// row 4: `references-search-params.ts`).
//
// BEFORE: search / industry / tag lived in three `useState` calls inside
// ReferencesPage (old :42-44). Nothing reached the address bar, so "the two
// healthcare references we keep reusing" was not a link you could paste into a
// bid review — it was a sequence of clicks you had to describe. Every value the
// view depends on now round-trips through the query string.
//
// ── WHERE THE PLAN AND THE CODE DISAGREE ────────────────────────────────────
// The plan specifies "facets: sector / region". The code has neither name:
// `Reference` (hooks/useReferences.ts) carries `industry` and `tags[]` and
// nothing else filterable, and `GET /api/references`
// (apps/api/src/routes/references.ts) accepts exactly `industry`, `companyId`,
// `tag`, `search`, `limit` — there is no region column, no region query param
// and no region anywhere in the Prisma model. So the facets are `industry`
// (the plan's "sector", spelled the way the field, the API param and the URL
// key all spell it — one name end to end, no translation layer) and `tag`.
//
// ── WHY SORT AND PAGE ARE APPLIED HERE, CLIENT-SIDE ─────────────────────────
// The list endpoint takes no `sort`/`dir`/`page` — it returns up to `limit`
// (default 50) rows in `createdAt desc`. Rather than pretend otherwise, the URL
// still owns sort/direction/page and this module applies them to the fetched
// page. Pure functions, no React, so they are unit-testable and the page file
// stays a view.

import type { Reference } from '@/hooks/useReferences';
import {
  ALL_SEGMENT,
  createListSearchParams,
  type ListInput,
} from '@/lib/table/list-search-params';

/** URL keys this surface owns beyond the reserved list-state keys. */
export type ReferenceFacet = 'industry' | 'tag';

export const REFERENCE_FACETS: readonly ReferenceFacet[] = ['industry', 'tag'];

export const referencesSearchParams = createListSearchParams<never, ReferenceFacet>({
  facetIds: REFERENCE_FACETS,
  // "Surface the best references" is the page's stated job, so the default view
  // is most-used first. It is a DEFAULT, therefore `clearOnDefault` keeps
  // `sort`/`dir` out of a freshly opened URL — /references stays bare.
  defaultSort: 'usageCount',
  defaultDir: 'desc',
  pageSize: 25,
});

export type ReferencesInput = ListInput<ReferenceFacet>;

/** `all` (and empty) mean "not filtering" and must never reach the API. */
function segment(value: string): string | undefined {
  return value && value !== ALL_SEGMENT ? value : undefined;
}

/** URL values → the exact filter object `useReferences` sends to the API. */
export function toReferencesFilters(input: ReferencesInput): {
  search?: string;
  industry?: string;
  tag?: string;
} {
  return {
    search: input.q || undefined,
    industry: segment(input.industry),
    tag: segment(input.tag),
  };
}

/** True when the empty state should offer "clear filters" rather than "add one". */
export function hasActiveReferenceFilters(input: ReferencesInput): boolean {
  const filters = toReferencesFilters(input);
  return Boolean(filters.search || filters.industry || filters.tag);
}

// A reference that has never been used has no `lastUsedAt`. Ranking it at epoch
// puts it last under the default "most recent first" and first when the user
// asks for ascending — either way it keeps a stable, explainable position
// instead of drifting with the sort implementation.
function usedAt(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

const COMPARATORS: Record<string, (a: Reference, b: Reference) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  company: (a, b) => (a.company?.name ?? '').localeCompare(b.company?.name ?? ''),
  industry: (a, b) => (a.industry ?? '').localeCompare(b.industry ?? ''),
  usageCount: (a, b) => a.usageCount - b.usageCount,
  lastUsedAt: (a, b) => usedAt(a.lastUsedAt) - usedAt(b.lastUsedAt),
};

export type ReferencesView = {
  /** The rows for the current page, in the current sort order. */
  rows: Reference[];
  /** Rows matching the current server-side filters, across all pages. */
  total: number;
};

/**
 * Sort + paginate the fetched page. An unknown `?sort=` (hand-edited, or a
 * column that was removed) falls through to the server's own order rather than
 * throwing or blanking the table.
 */
export function applyReferencesView(
  items: readonly Reference[],
  input: ReferencesInput,
): ReferencesView {
  const compare = COMPARATORS[input.sort];
  const factor = input.dir === 'asc' ? 1 : -1;
  const sorted = compare ? [...items].sort((a, b) => compare(a, b) * factor) : [...items];
  const start = (input.page - 1) * input.pageSize;
  return { rows: sorted.slice(start, start + input.pageSize), total: items.length };
}

export type FacetOption = { value: string; label: string };

function toOptions(values: Iterable<string>): FacetOption[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b)).map((value) => ({
    value,
    label: value,
  }));
}

/**
 * Facet options are derived from the UNFILTERED library, never from the filtered
 * result — deriving them from the visible rows collapses each dropdown to the
 * value already selected and traps the user (the bug the old tag dropdown was
 * explicitly written to avoid, old ReferencesPage :55-58).
 *
 * Values are shown verbatim (`financial_services`, not "Financial services"):
 * they are org data written by the API, not UI copy, and a prettified label
 * would no longer match what the querystring carries.
 */
export function referenceIndustryOptions(items: readonly Reference[]): FacetOption[] {
  return toOptions(items.map((item) => item.industry).filter((v): v is string => Boolean(v)));
}

export function referenceTagOptions(items: readonly Reference[]): FacetOption[] {
  return toOptions(items.flatMap((item) => item.tags));
}
