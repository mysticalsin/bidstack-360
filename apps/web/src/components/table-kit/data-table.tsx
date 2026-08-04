// Ported from D:\CRM\packages\ui\src\components\data-table.tsx (604 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #1) — the centrepiece of the graft.
//
// WHAT IT IS: a headless dense data grid. Verified against the source: ZERO
// @tanstack/react-table (`rg tanstack packages/ui` → 0 matches). The only
// runtime dependencies are React, nuqs, and sibling table-kit modules. Row
// data, totals and sorting all arrive as props — the component owns nothing
// but the two pieces of view state that belong in the URL (which rows are
// expanded, which columns are hidden).
//
// WHAT CHANGED IN THE PORT:
//   * 7 Carbon glyphs → BidStack's existing <Icon>. Icon.tsx is untouched
//     (346 call sites), so glyphs that BidStack does not ship are composed
//     from ones it does — see SortGlyph below and the `pipeline` note.
//   * CRM Button variants `outline` → `secondary`, `ghost` stays. The CRM's
//     `size="xs"` has no BidStack peer; header buttons use `sm` with an
//     explicit `h-auto` so they sit inside the 44px header row.
//   * Every shadcn semantic classname rewritten to BidStack's vocabulary
//     (bg-card → bg-surface-card, text-muted-foreground → text-fg-secondary,
//     bg-muted → bg-surface-sunken, bg-muted/30 → bg-surface-soft).
//   * All ~11 hardcoded strings through t(), keys in all seven locale trees.
//   * `"use client"` dropped: this is a Vite SPA, there is no RSC boundary and
//     no server `load` half to pair with. URL state is client-side nuqs on
//     react-router v6 (NuqsAdapter is mounted once in main.tsx).
//
// WHAT WAS ADDED (density law, ROUND2-ULTRAPLAN "DoD" for the four surfaces):
//   * right-aligned columns get `tabular-nums` automatically — a numeric
//     column that doesn't align on the decimal is not a numeric column.
//   * a cell whose renderer returns null/undefined/'' renders <EmptyCellValue/>
//     (the em-dash), so a null never collapses a row's baseline. Opt out per
//     column with `allowBlank` (action columns, checkboxes).

import {
  Fragment,
  useDeferredValue,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/table-kit/dropdown-menu';
import { EmptyCellValue } from '@/components/table-kit/empty-cell';
import { Spinner } from '@/components/table-kit/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/table-kit/table';
import { TablePagination } from '@/components/table-kit/table-pagination';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { ROW_ACCENT, ROW_ACCENT_EXPANDABLE } from '@/lib/table/row-accent';
import type { TableQueryState } from '@/lib/table/table-query';

export type DataTableColumn<TRow> = {
  id: string;
  header: ReactNode;
  cell: (row: TRow) => ReactNode;
  /** Menu label when `header` is not a plain string. */
  label?: string;
  sortable?: boolean;
  /** Tailwind width class, e.g. `w-32`. Pairs with the table's `table-fixed`. */
  width?: string;
  align?: 'left' | 'right' | 'center';
  headClassName?: string;
  cellClassName?: string;
  hideable?: boolean;
  defaultHidden?: boolean;
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Force tabular figures on a column that isn't right-aligned (IDs, dates). */
  numeric?: boolean;
  /** Opt out of the em-dash null render — for action / checkbox columns. */
  allowBlank?: boolean;
};

export type DataTableFacet = {
  id: string;
  label: string;
  options: { value: string; label: string }[];
};

export type DataTableTabs = {
  id: string;
  allLabel?: string;
  options: { value: string; label: string }[];
};

export type DataTableExpandable<TRow, TSub> = {
  isExpandable: (row: TRow) => boolean;
  getSubRows: (row: TRow) => TSub[];
  getSubRowId: (sub: TSub, row: TRow) => string;
  renderSubCell: (sub: TSub, columnId: string, row: TRow) => ReactNode;
  onSubRowClick?: (sub: TSub, row: TRow) => void;
};

export type DataTableProps<TRow, TSub> = {
  query: TableQueryState;
  columns: DataTableColumn<TRow>[];
  getRowId: (row: TRow) => string;
  rows: TRow[];
  total: number;
  facetCounts?: Record<string, Record<string, number>>;
  loading?: boolean;
  facets?: DataTableFacet[];
  tabs?: DataTableTabs;
  onRowClick?: (row: TRow) => void;
  onRowHover?: (row: TRow) => void;
  expandable?: DataTableExpandable<TRow, TSub>;
  actions?: ReactNode;
  leadingActions?: ReactNode;
  /** Overrides the pagination range readout (e.g. "3 selected"). */
  meta?: ReactNode;
  empty?: ReactNode;
  className?: string;
  tableClassName?: string;
};

const HIDE_BELOW_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
} as const;

// Right alignment implies numbers, and numbers in a dense grid must share a
// glyph advance or the column stops scanning as a column.
const ALIGN_CLASS = {
  left: '',
  right: 'text-right tabular-nums',
  center: 'text-center',
} as const;

function columnLabel<TRow>(column: DataTableColumn<TRow>): string {
  if (column.label) return column.label;
  return typeof column.header === 'string' ? column.header : column.id;
}

function columnBodyClass<TRow>(column: DataTableColumn<TRow>): string {
  return cn(
    column.width,
    ALIGN_CLASS[column.align ?? 'left'],
    column.numeric && 'tabular-nums',
    column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow],
    column.cellClassName,
  );
}

/**
 * A null cell renders the em-dash, never nothing: a blank cell loses its
 * baseline and the row visually breaks. `0` and `false` are data, not absence.
 */
function renderCellValue(value: ReactNode, allowBlank?: boolean): ReactNode {
  if (allowBlank) return value;
  return value == null || value === '' ? <EmptyCellValue /> : value;
}

/**
 * The CRM used Carbon's `ArrowsVertical` for "sortable, not currently sorted".
 * BidStack ships no up-down glyph and Icon.tsx is out of scope this commit, so
 * the pair is composed from the two carets it does ship — the negative margins
 * overlap them into one 12px chevrons-up-down mark.
 */
function SortGlyph({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col items-center leading-none', className)}>
      <Icon name="caretup" size={10} className="-mb-1" />
      <Icon name="caret" size={10} className="-mt-1" />
    </span>
  );
}

function SortIndicator({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span className="text-fg-secondary">
      {active ? (
        <Icon name={dir === 'asc' ? 'caretup' : 'caret'} size={12} />
      ) : (
        <SortGlyph className="opacity-40" />
      )}
    </span>
  );
}

export function DataTable<TRow, TSub = unknown>({
  query,
  columns,
  getRowId,
  rows,
  total,
  facetCounts,
  loading,
  facets,
  tabs,
  onRowClick,
  onRowHover,
  expandable,
  actions,
  leadingActions,
  meta,
  empty,
  className,
  tableClassName,
}: DataTableProps<TRow, TSub>) {
  const { t } = useTranslation('common');

  // Expanded rows and hidden columns live in the URL, not in state: pasting a
  // link reproduces the exact view, and Back walks it. nuqs is wired to
  // react-router v6 by the single NuqsAdapter in main.tsx.
  const [expandedIds, setExpandedIds] = useQueryState(
    'expand',
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds]);

  const defaultHiddenIds = useMemo(
    () => columns.filter((column) => column.defaultHidden).map((column) => column.id),
    [columns],
  );
  // Memoised so the parser identity is stable across renders — otherwise every
  // render hands nuqs a fresh parser and re-subscribes the key.
  const hideParser = useMemo(
    () => parseAsArrayOf(parseAsString).withDefault(defaultHiddenIds),
    [defaultHiddenIds],
  );
  const [hidden, setHidden] = useQueryState('hide', hideParser);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();

  const hideable = columns.filter((column) => column.hideable !== false);
  const visibleColumns = columns.filter((column) => !hidden.includes(column.id));
  const sortableColumns = columns.filter((column) => column.sortable);

  const tabCounts = tabs ? facetCounts?.[tabs.id] : undefined;
  const allLabel = tabs?.allLabel ?? t('tableKit.dataTable.all', 'All');
  const activeTabOption =
    query.tab === 'all' ? undefined : tabs?.options.find((option) => option.value === query.tab);
  const activeTabLabel = activeTabOption ? activeTabOption.label : allLabel;

  // Deferred so a large page swap paints the new chrome immediately and the
  // rows catch up, instead of blocking the whole tree on the row render.
  const deferredRows = useDeferredValue(rows);
  const anyExpandable =
    expandable != null && deferredRows.some((row) => expandable.isExpandable(row));
  const colCount = visibleColumns.length + (anyExpandable ? 1 : 0);

  const pageSize = query.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const hasFilterControls =
    tabs != null ||
    (facets?.length ?? 0) > 0 ||
    sortableColumns.length > 0 ||
    anyExpandable ||
    hideable.length > 0 ||
    actions != null ||
    leadingActions != null;
  const activeFilterCount =
    (tabs && query.tab !== 'all' ? 1 : 0) +
    (facets?.filter((facet) => (query.filters[facet.id] ?? 'all') !== 'all').length ?? 0);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>
      <div className="flex flex-col gap-3">
        {hasFilterControls && (
          // Below `sm` the whole control bar collapses behind one disclosure —
          // a phone gets the table, not the toolbar.
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-between sm:hidden"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span className="flex items-center gap-2">
              <Icon name="sliders" size={14} />
              {t('tableKit.dataTable.filters', 'Filters')}
              {activeFilterCount > 0 && (
                <span className="tabular-nums opacity-60">({activeFilterCount})</span>
              )}
            </span>
            <Icon
              name="chevron-down"
              size={14}
              className={cn(
                'shrink-0 opacity-60 transition-transform',
                filtersOpen && 'rotate-180',
              )}
            />
          </Button>
        )}
        <div
          id={filtersId}
          className={cn(
            'flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between',
            filtersOpen ? 'flex' : 'hidden sm:flex',
          )}
        >
          {tabs && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-between sm:w-auto sm:min-w-44"
                >
                  <span className="truncate">{activeTabLabel}</span>
                  <Icon name="chevron-down" size={14} className="shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52">
                <DropdownMenuRadioGroup
                  value={query.tab}
                  onValueChange={(value) => query.setTab(value)}
                >
                  <DropdownMenuRadioItem value="all">
                    <span className="flex-1">{allLabel}</span>
                  </DropdownMenuRadioItem>
                  {tabs.options.map((option) => {
                    // A tab the current filter set can never populate is noise.
                    if (tabCounts?.[option.value] === 0) return null;
                    return (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        <span className="flex-1">{option.label}</span>
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {leadingActions}

          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center lg:ml-auto">
            {facets?.map((facet) => {
              const selected = query.filters[facet.id] ?? 'all';
              const active = facet.options.find((option) => option.value === selected);
              return (
                <DropdownMenu key={facet.id}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" className="justify-between">
                      <span className="truncate">{active ? active.label : facet.label}</span>
                      <Icon name="chevron-down" size={14} className="opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-44">
                    <DropdownMenuRadioGroup
                      value={selected}
                      onValueChange={(value) => query.setFilter(facet.id, value)}
                    >
                      <DropdownMenuRadioItem value="all">{facet.label}</DropdownMenuRadioItem>
                      {facet.options.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value}>
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
            {(sortableColumns.length > 0 || anyExpandable) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-start sm:justify-center"
                  >
                    <SortGlyph />
                    {t('tableKit.dataTable.sort', 'Sort')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuLabel>
                    {t('tableKit.dataTable.sortBy', 'Sort by')}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={query.sort} onValueChange={query.setSort}>
                    {anyExpandable && (
                      <DropdownMenuRadioItem value="detail">
                        {t('tableKit.dataTable.detail', 'Detail')}
                      </DropdownMenuRadioItem>
                    )}
                    {sortableColumns.map((column) => (
                      <DropdownMenuRadioItem key={column.id} value={column.id}>
                        {columnLabel(column)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={query.dir}
                    onValueChange={(value) => query.setDir(value === 'desc' ? 'desc' : 'asc')}
                  >
                    <DropdownMenuRadioItem value="asc">
                      {t('tableKit.dataTable.ascending', 'Ascending')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="desc">
                      {t('tableKit.dataTable.descending', 'Descending')}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {hideable.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-start sm:justify-center"
                  >
                    {/* `pipeline` is three vertical bars — BidStack's own
                        columns glyph, no Icon.tsx edit needed. */}
                    <Icon name="pipeline" size={14} />
                    {t('tableKit.dataTable.columns', 'Columns')}
                    <span className="tabular-nums opacity-60">({visibleColumns.length})</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuLabel>
                    {t('tableKit.dataTable.toggleColumns', 'Toggle columns')}
                  </DropdownMenuLabel>
                  {hideable.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={!hidden.includes(column.id)}
                      onCheckedChange={(checked) =>
                        void setHidden((prev) => {
                          const set = new Set(prev);
                          if (checked) set.delete(column.id);
                          else set.add(column.id);
                          return [...set];
                        })
                      }
                    >
                      {columnLabel(column)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {actions}
          </div>
        </div>
      </div>

      <Table
        aria-busy={loading || undefined}
        className={cn(
          'table-fixed [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4',
          tableClassName,
        )}
        containerClassName="min-h-0 flex-1 overflow-auto rounded-lg border border-border-default bg-surface-card"
      >
        {/* The header stays put while the body scrolls; the inset shadow is the
            only rule under it, so no border seam shows through on scroll. */}
        <TableHeader className="sticky top-0 z-10 bg-surface-sunken [&_th]:bg-surface-sunken [&_tr]:border-0 [&_tr]:shadow-[inset_0_-1px_0_var(--border-default)]">
          <TableRow>
            {anyExpandable && (
              <TableHead className="h-11 w-10 px-3">
                <span className="sr-only">{t('tableKit.dataTable.detail', 'Detail')}</span>
              </TableHead>
            )}
            {visibleColumns.map((column) => {
              const isActive = query.sort === column.id;
              return (
                <TableHead
                  key={column.id}
                  className={cn(
                    'h-11 overflow-hidden px-3 font-normal text-fg-secondary',
                    column.width,
                    ALIGN_CLASS[column.align ?? 'left'],
                    column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow],
                    column.headClassName,
                  )}
                  aria-sort={
                    isActive ? (query.dir === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {column.sortable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => query.toggleSort(column.id)}
                      className={cn(
                        '-ml-2 h-auto px-2 py-1 font-normal text-fg-secondary hover:text-fg-primary',
                        column.align === 'right' && '-mr-2 ml-0 flex-row-reverse',
                        column.align === 'center' && 'mx-auto',
                      )}
                    >
                      {column.header}
                      <SortIndicator active={isActive} dir={query.dir} />
                    </Button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {deferredRows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={colCount}
                className="h-32 whitespace-normal py-8 text-center align-middle text-fg-secondary"
              >
                {loading ? <Spinner /> : (empty ?? t('tableKit.dataTable.noResults', 'No results found.'))}
              </TableCell>
            </TableRow>
          ) : (
            deferredRows.map((row) => {
              const id = getRowId(row);
              const canExpand = expandable?.isExpandable(row) ?? false;
              const isOpen = canExpand && expanded.has(id);
              const clickable = canExpand || !!onRowClick;
              const handleClick = () => {
                if (canExpand) {
                  void setExpandedIds((prev) => {
                    const set = new Set(prev);
                    if (set.has(id)) set.delete(id);
                    else set.add(id);
                    const next = [...set];
                    // Drop the key entirely when nothing is expanded so the URL
                    // stays clean and shareable.
                    return next.length > 0 ? next : null;
                  });
                } else {
                  onRowClick?.(row);
                }
              };
              return (
                <Fragment key={id}>
                  <TableRow
                    onClick={clickable ? handleClick : undefined}
                    onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                    onFocus={onRowHover ? () => onRowHover(row) : undefined}
                    aria-expanded={canExpand ? isOpen : undefined}
                    className={
                      clickable
                        ? anyExpandable
                          ? ROW_ACCENT_EXPANDABLE
                          : ROW_ACCENT
                        : undefined
                    }
                  >
                    {anyExpandable && (
                      <TableCell className="w-10 px-3 py-3 text-center text-fg-secondary">
                        {canExpand && (
                          <Icon
                            name="chevron-right"
                            size={12}
                            className={cn(
                              'inline-block transition-transform',
                              isOpen && 'rotate-90',
                            )}
                          />
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn('overflow-hidden px-3 py-3', columnBodyClass(column))}
                      >
                        {renderCellValue(column.cell(row), column.allowBlank)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {isOpen &&
                    expandable?.getSubRows(row).map((sub) => {
                      const subClickable = !!expandable.onSubRowClick;
                      return (
                        <TableRow
                          key={expandable.getSubRowId(sub, row)}
                          onClick={
                            subClickable ? () => expandable.onSubRowClick?.(sub, row) : undefined
                          }
                          className={cn(
                            'bg-surface-soft',
                            subClickable &&
                              (anyExpandable ? ROW_ACCENT_EXPANDABLE : ROW_ACCENT),
                          )}
                        >
                          {anyExpandable && <TableCell className="w-10 px-3 py-2.5" />}
                          {visibleColumns.map((column) => (
                            <TableCell
                              key={column.id}
                              className={cn(
                                'overflow-hidden px-3 py-2.5 align-top',
                                columnBodyClass(column),
                              )}
                            >
                              {renderCellValue(
                                expandable.renderSubCell(sub, column.id, row),
                                column.allowBlank,
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>

      <TablePagination
        page={query.page}
        totalPages={totalPages}
        pageSize={pageSize}
        total={total}
        onPageChange={(page) => query.setPage(page)}
        loading={loading}
        meta={meta}
      />
    </div>
  );
}
