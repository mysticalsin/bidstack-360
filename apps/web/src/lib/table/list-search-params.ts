// The CLIENT half of D:\CRM\apps\app\components\data-table\list-search-params.ts
// (113 lines). ROUND2-ULTRAPLAN "URL-as-state": every filtered view of the four
// bid surfaces is a shareable URL.
//
// WHAT A SURFACE GETS: it declares its params once — tab/status, sort, page,
// page size, facets, expanded rows — and `useTableQuery` (sibling file) hands
// back typed getters/setters that round-trip through the query string.
//
// ── WHAT WAS DROPPED, AND WHY: the server half ──────────────────────────────
// The CRM is Next.js RSC. Its file also builds `load = createLoader(parsers)`
// (a `nuqs/server` LoaderFunction) so a server component can parse `searchParams`
// before it renders, and it imports every parser from `nuqs/server`. BidStack's
// web app is a Vite SPA behind `BrowserRouter` — there is no server render pass,
// no RSC boundary, and nothing to hand a loader to. `load` is therefore NOT
// ported and nothing here fakes it: the only reader of these parsers is the
// client hook, through the single `NuqsAdapter` mounted in main.tsx. If BidStack
// ever grows an SSR pass, re-add `load` here rather than reinventing it in a page.
//
// ── THE MERGE LAW ───────────────────────────────────────────────────────────
// docs/design-system/url-param-audit.md §4 found five call sites that write the
// query string with an object literal (`setSearchParams({ ... })`), which DROPS
// every param not in the literal — two of them are live bugs (AuditLogSection's
// "clear filters" wipes Settings' `?tab=`; ProposalsPage clears `?new=1` as a
// side effect of clearing `?status=`). Everything built on this module writes
// through nuqs, which merges: a write touches the named keys and leaves every
// other param — owned by a sibling component or by nothing at all — alone. Even
// `reset()` clears only the keys declared here. That behaviour is the point of
// this module and it is unit-tested explicitly in list-search-params.test.ts.
//
// ── HISTORY MODES ───────────────────────────────────────────────────────────
// Per the audit §6: `replace` for filters, facets, search and sort (they refine
// one view); `push` for pagination (Back should walk pages). Rather than mix
// per-parser history modes inside one multi-key write — where the combined mode
// would be ambiguous — every parser here declares `replace` and `useTableQuery`
// passes `{ history: 'push' }` per call on the writes that need it.

import {
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type ParserBuilder,
} from 'nuqs';

import type { SortDirection } from '@/lib/table/table-query';

/** The value a tab/facet takes when it is not filtering. Never appears in the URL. */
export const ALL_SEGMENT = 'all';

/**
 * Row-expansion key. `DataTable` already registers this exact key with this
 * exact parser (data-table.tsx:225), so a surface built on `DataTable` gets
 * expansion for free; the copy here exists for surfaces that render their own
 * body (ComplianceMatrix's evidence strip) and for the two to agree on one key.
 */
export const EXPANDED_ROWS_KEY = 'expand';

/** Hidden-column key, owned by `DataTable` (data-table.tsx:241). Reserved here so no facet can claim the name. */
export const HIDDEN_COLUMNS_KEY = 'hide';

export const DEFAULT_PAGE_SIZE = 25;

const SORT_DIRECTIONS = ['asc', 'desc'] as const;

// clearOnDefault is nuqs 2.x's default; it is stated on every parser because a
// default value in the querystring is litter — `?view=list&filter=all` is the
// existing app-wide convention (TasksPage.tsx:159,174) and the audit §6 pins it.
const BASE_OPTIONS = { history: 'replace', clearOnDefault: true } as const;

type StringParser = ParserBuilder<string> & { defaultValue: string };
type NumberParser = ParserBuilder<number> & { defaultValue: number };
type DirParser = ParserBuilder<SortDirection> & { defaultValue: SortDirection };
type StringListParser = ParserBuilder<string[]> & { defaultValue: string[] };

const segmentParser = (defaultValue: string): StringParser =>
  parseAsString.withOptions(BASE_OPTIONS).withDefault(defaultValue);

/**
 * Keys this module owns. A tab or facet may not claim one: two owners on one key
 * with two different defaults is the class of bug the audit was written to stop.
 */
const RESERVED_KEYS: readonly string[] = [
  'q',
  'sort',
  'dir',
  'page',
  'pageSize',
  EXPANDED_ROWS_KEY,
  HIDDEN_COLUMNS_KEY,
];

export type ListParsers<TKey extends string> = {
  q: StringParser;
  sort: StringParser;
  dir: DirParser;
  page: NumberParser;
  pageSize: NumberParser;
  [EXPANDED_ROWS_KEY]: StringListParser;
} & { [K in TKey]: StringParser };

/** Everything the URL carries for a list surface. */
export type ListSearchValues<TKey extends string> = {
  q: string;
  sort: string;
  dir: SortDirection;
  page: number;
  pageSize: number;
  expand: string[];
} & { [K in TKey]: string };

/**
 * What a surface sends to the API. `expand` is deliberately absent: which rows
 * are open is view state, not a query predicate.
 */
export type ListInput<TKey extends string> = {
  q: string;
  sort: string;
  dir: SortDirection;
  page: number;
  pageSize: number;
} & { [K in TKey]: string };

export type ListSearchParamsConfig<TTab extends string, TFacet extends string> = {
  /** Column id sorted by default. Empty string = server default order. */
  defaultSort?: string;
  defaultDir?: SortDirection;
  pageSize?: number;
  /** URL key carrying the tab/status segment, e.g. `'status'`. */
  tabId?: TTab;
  /** Segment value meaning "no tab filter". Defaults to `'all'`. */
  defaultTab?: string;
  facetIds?: readonly TFacet[];
  facetDefaults?: Partial<Record<TFacet, string>>;
};

export type ResolvedListConfig<TTab extends string, TFacet extends string> =
  ListSearchParamsConfig<TTab, TFacet> & {
    defaultSort: string;
    defaultDir: SortDirection;
    pageSize: number;
    defaultTab: string;
    facetIds: readonly TFacet[];
  };

export type ListSearchParams<TTab extends string, TFacet extends string> = {
  config: ResolvedListConfig<TTab, TFacet>;
  parsers: ListParsers<TTab | TFacet>;
  /** Tab key first (when declared), then facet keys, in declaration order. */
  keys: readonly (TTab | TFacet)[];
  /** Default segment per tab/facet key — what `clearOnDefault` strips from the URL. */
  segmentDefaults: Readonly<Record<string, string>>;
  toInput: (values: ListSearchValues<TTab | TFacet>) => ListInput<TTab | TFacet>;
  /**
   * Builds a query string for a partial set of values — for a deep link, a
   * saved view, or an `<a href>` that opens the surface pre-filtered. Defaults
   * are omitted, exactly as a write would leave them.
   */
  serialize: (values: Partial<ListSearchValues<TTab | TFacet>>) => string;
};

function assertUnreserved(keys: readonly string[]): void {
  const clash = keys.find((key) => RESERVED_KEYS.includes(key));
  if (clash) {
    throw new Error(
      `createListSearchParams: "${clash}" is a reserved URL key (${RESERVED_KEYS.join(', ')}). ` +
        'Rename the tab or facet — two owners on one key is the bug url-param-audit.md §4 documents.',
    );
  }
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) {
    throw new Error(`createListSearchParams: duplicate tab/facet key "${duplicate}".`);
  }
}

function buildParsers<TKey extends string>(
  defaultSort: string,
  defaultDir: SortDirection,
  pageSize: number,
  segments: Record<string, StringParser>,
): ListParsers<TKey> {
  return {
    q: parseAsString.withOptions(BASE_OPTIONS).withDefault(''),
    sort: parseAsString.withOptions(BASE_OPTIONS).withDefault(defaultSort),
    dir: parseAsStringLiteral(SORT_DIRECTIONS).withOptions(BASE_OPTIONS).withDefault(defaultDir),
    page: parseAsInteger.withOptions(BASE_OPTIONS).withDefault(1),
    pageSize: parseAsInteger.withOptions(BASE_OPTIONS).withDefault(pageSize),
    [EXPANDED_ROWS_KEY]: parseAsArrayOf(parseAsString)
      .withOptions(BASE_OPTIONS)
      .withDefault([] as string[]),
    ...segments,
  } as unknown as ListParsers<TKey>;
}

/**
 * Declare a list surface's URL state once. Returns the parser map `useTableQuery`
 * binds to, plus the pure helpers (`toInput`, `serialize`) that need no React —
 * which is why they live here and not in the hook: they are unit-testable and
 * reusable from a link builder.
 */
export function createListSearchParams<
  TTab extends string = never,
  TFacet extends string = never,
>(
  config: ListSearchParamsConfig<TTab, TFacet> = {},
): ListSearchParams<TTab, TFacet> {
  const {
    defaultSort = '',
    defaultDir = 'asc',
    pageSize = DEFAULT_PAGE_SIZE,
    defaultTab = ALL_SEGMENT,
    tabId,
    facetIds = [],
    facetDefaults,
  } = config;

  const keys = [...(tabId ? [tabId] : []), ...facetIds] as (TTab | TFacet)[];
  assertUnreserved(keys);

  const segmentDefaults: Record<string, string> = {};
  if (tabId) segmentDefaults[tabId] = defaultTab;
  for (const id of facetIds) segmentDefaults[id] = facetDefaults?.[id] ?? ALL_SEGMENT;

  const segments: Record<string, StringParser> = {};
  for (const key of keys) segments[key] = segmentParser(segmentDefaults[key] as string);

  const parsers = buildParsers<TTab | TFacet>(defaultSort, defaultDir, pageSize, segments);
  // nuqs infers the serializer's argument through `keyof inferParserType<…>`,
  // which widens to `string` across the mapped tab/facet half of ListParsers and
  // then fails to narrow back. The runtime contract is exact; only the inference
  // is lossy, so the boundary is retyped rather than the map restructured.
  const serialize = createSerializer(parsers) as unknown as (
    values: Partial<ListSearchValues<TTab | TFacet>>,
  ) => string;

  return {
    config: { ...config, defaultSort, defaultDir, pageSize, defaultTab, facetIds },
    parsers,
    keys,
    segmentDefaults,
    toInput: (values) => {
      const selected: Record<string, string> = {};
      for (const key of keys) {
        selected[key] = values[key] ?? segmentDefaults[key] ?? ALL_SEGMENT;
      }
      return {
        q: values.q.trim(),
        sort: values.sort,
        dir: values.dir,
        // A hand-edited `?page=0` or `?pageSize=-1` is user input, not a
        // contract — clamp rather than send it to the API.
        page: values.page > 0 ? values.page : 1,
        pageSize: values.pageSize > 0 ? values.pageSize : pageSize,
        ...selected,
      } as ListInput<TTab | TFacet>;
    },
    serialize,
  };
}
