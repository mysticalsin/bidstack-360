import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import {
  EmptyState,
  EmptyStateLink,
  ErrorState,
  LoadingSkeleton,
} from '@/components/ui/StateMessages';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { SpotlightTable } from '@/components/ui/SpotlightTable';
import { SortableHeader, getSortableHeaderAriaSort } from '@/components/ui/SortableHeader';
import type { SortState } from '@/components/ui/SortableHeader';
import { useTableSort } from '@/hooks/useTableSort';
import { confirm as confirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { useHasAdminPermission } from '@/hooks/useCapabilities';
import { useCompanies, useCreateCompany, useDeleteCompany } from '@/hooks/useCompanies';
import { useIntelImports } from '@/hooks/useCompanyIntelSummary';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { CursorPager } from '@/components/ui/CursorPager';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { downloadCsv, rowsToCsv } from '@/lib/csv';

import { DuplicatesDialog } from '@/components/company/DuplicatesDialog';

import { CompanyIntelView, IntelDirection } from '@bidstack/shared';

import { CompanyRow } from './companiesPage/CompanyRow';
import { INTEL_COLUMNS } from './companiesPage/IntelCells';
import { IntelImportProgress } from './companiesPage/IntelImportProgress';
import { IntelViewsBar } from './companiesPage/IntelViewsBar';
import { useColumnVisibility } from './companiesPage/useColumnVisibility';

const BASE_COLUMNS = [
  { key: 'domain', label: 'Domain' },
  { key: 'industry', label: 'Industry' },
  { key: 'countryCode', label: 'Country' },
] as const;
const TOGGLE_COLUMNS = [...BASE_COLUMNS, ...INTEL_COLUMNS];
const DIRECTION_RANK = { contracting: 0, steady: 1, growing: 2 } as const;
import { NewCompanyDialog } from './companiesPage/NewCompanyDialog';

export function CompaniesPage() {
  const { t } = useTranslation('crm');
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const searchParam = params.get('search') ?? undefined;
  // Debounce the value that feeds the query key so a server fetch fires once the
  // user pauses typing — not on every keystroke (a per-keystroke request storm at
  // 100k-company scale). The raw URL param still drives the input for responsive
  // typing. Same pattern Round 1 used for KeyAccountsPage.
  const debouncedSearch = useDebouncedValue(searchParam, 250);
  const viewParse = CompanyIntelView.safeParse(params.get('view'));
  const view = viewParse.success ? viewParse.data : null;
  const directionParse = IntelDirection.safeParse(params.get('direction'));
  const direction = directionParse.success ? directionParse.data : null;
  const pager = useCursorPagination(`${debouncedSearch ?? ''}|${view ?? ''}|${direction ?? ''}`);
  const filter = useMemo(
    () => ({
      search: debouncedSearch,
      limit: 50,
      ...(view ? { view } : {}),
      ...(direction ? { direction } : {}),
      ...(pager.cursor ? { cursor: pager.cursor } : {}),
    }),
    [debouncedSearch, view, direction, pager.cursor],
  );
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const columns = useColumnVisibility();
  const BASE_I18N: Record<string, string> = {
    domain: 'companies.table.domain',
    industry: 'companies.table.industry',
    countryCode: 'companies.table.country',
  };
  const columnLabel = (c: { key: string; label: string }) =>
    BASE_I18N[c.key] ? t(BASE_I18N[c.key]!, c.label) : c.label;
  const imports = useIntelImports();

  const companies = useCompanies(filter);
  const createCompany = useCreateCompany();
  const deleteCompany = useDeleteCompany();
  // Company writes are gated server-side behind companies:write + the literal
  // 'admin' role — hide the write affordances for everyone else instead of
  // showing a button that always 403s (matches ReferencesPage/ProposalDetailPage).
  const canWrite = useHasAdminPermission('companies:write');

  const rawItems = useMemo(() => companies.data?.items ?? [], [companies.data?.items]);

  // Column sorting (parity with Opportunities/Contacts/Leads). Sorts the current
  // page client-side; URL-persisted so a sorted view is shareable.
  type CompanyItem = (typeof rawItems)[number];
  type CompanySortKey =
    'name' | 'domain' | 'industry' | 'countryCode' | (typeof INTEL_COLUMNS)[number]['key'];
  const accessors = useMemo(
    (): Record<CompanySortKey, (c: CompanyItem) => string | number | null> => ({
      name: (c) => c.name,
      domain: (c) => c.domain ?? null,
      industry: (c) => c.industry ?? null,
      countryCode: (c) => c.countryCode ?? null,
      revenue: (c) => c.intel?.revenue?.approxUsd ?? null,
      revenueGrowth: (c) => c.intel?.revenueGrowth?.value ?? null,
      headcount: (c) => c.intel?.headcount?.value ?? c.employeeCount ?? null,
      headcountGrowth: (c) => c.intel?.headcountGrowth?.value ?? null,
      openRoles: (c) => c.intel?.openRoles?.value ?? null,
      newRoles30d: (c) => c.intel?.newRoles30d?.value ?? null,
      hiringTrend: (c) => c.intel?.newRoles30d?.trend30Pct ?? null,
      funding: (c) => c.intel?.funding?.value ?? null,
      signal: (c) => c.intel?.signal?.publishedAt ?? null,
      direction: (c) => (c.intel?.direction ? DIRECTION_RANK[c.intel.direction.value] : null),
    }),
    [],
  );
  const parseSortParam = (raw: string | null): SortState<CompanySortKey> => {
    if (!raw) return { key: null, dir: null };
    const [k, d] = raw.split('.');
    if (!k || !(k in accessors) || (d !== 'asc' && d !== 'desc')) return { key: null, dir: null };
    return { key: k as CompanySortKey, dir: d };
  };
  const sortState = parseSortParam(params.get('sort'));
  const setSortState = (next: SortState<CompanySortKey>) => {
    const p = new URLSearchParams(params);
    if (!next.key || !next.dir) p.delete('sort');
    else p.set('sort', `${next.key}.${next.dir}`);
    setParams(p, { replace: true });
  };
  const { sorted } = useTableSort(rawItems, accessors, {
    state: sortState,
    onChange: setSortState,
  });
  // ReadonlyArray -> mutable for the bulk-selection/consumers; identity stable.
  const items = sorted as CompanyItem[];
  const bulk = useBulkSelection(items);
  // Input reads the raw URL param so typing is responsive; result/empty-state copy
  // reflects the debounced term that actually drove the fetch.
  const inputValue = searchParam ?? '';
  const searchTerm = filter.search ?? '';

  const stats = useMemo(() => {
    const withDomain = items.filter((company) => Boolean(company.domain)).length;
    const withIndustry = items.filter((company) => Boolean(company.industry)).length;
    const countries = new Set(items.map((company) => company.countryCode).filter(Boolean));
    return [
      {
        label: t('companies.stats.visibleLabel', 'Visible companies'),
        value: items.length.toLocaleString(),
        detail: t('companies.stats.visibleDetail', 'current view'),
      },
      {
        label: t('companies.stats.domainLabel', 'Domain coverage'),
        value: `${withDomain}/${items.length || 0}`,
        detail: t('companies.stats.domainDetail', 'ready for data verification'),
      },
      {
        label: t('companies.stats.industriesLabel', 'Industries'),
        value: withIndustry.toLocaleString(),
        detail: t('companies.stats.industriesDetail', 'classified profiles'),
      },
      {
        label: t('companies.stats.countriesLabel', 'Countries'),
        value: countries.size.toLocaleString(),
        detail: t('companies.stats.countriesDetail', 'market coverage'),
      },
    ];
  }, [items, t]);

  const exportSelected = () => {
    if (bulk.selectedItems.length === 0) {
      toast.info(t('companies.toast.nothingToExport', 'Nothing to export'));
      return;
    }
    const csv = rowsToCsv(
      bulk.selectedItems.map((c) => ({
        name: c.name,
        legalName: c.legalName ?? '',
        domain: c.domain ?? '',
        industry: c.industry ?? '',
        employeeCount: c.employeeCount?.toString() ?? '',
        countryCode: c.countryCode ?? '',
      })),
      [
        { key: 'name', label: 'Name' },
        { key: 'legalName', label: 'Legal Name' },
        { key: 'domain', label: 'Domain' },
        { key: 'industry', label: 'Industry' },
        { key: 'employeeCount', label: 'Employees' },
        { key: 'countryCode', label: 'Country' },
      ],
    );
    downloadCsv(`polo-presales-companies-${new Date().toISOString().slice(0, 10)}`, csv);
    toast.success(
      bulk.selectedItems.length === 1
        ? t('companies.toast.exportedOne', 'Exported {{count}} company', {
            count: bulk.selectedItems.length,
          })
        : t('companies.toast.exportedMany', 'Exported {{count}} companies', {
            count: bulk.selectedItems.length,
          }),
    );
  };

  const bulkDelete = async () => {
    if (bulk.selectedItems.length === 0) return;
    const ok = await confirmDialog({
      title:
        bulk.selectedItems.length === 1
          ? t('companies.confirmDelete.titleOne', 'Delete {{count}} company?', {
              count: bulk.selectedItems.length,
            })
          : t('companies.confirmDelete.titleMany', 'Delete {{count}} companies?', {
              count: bulk.selectedItems.length,
            }),
      description: t('companies.confirmDelete.description', 'This action cannot be undone.'),
      confirmLabel: t('companies.confirmDelete.confirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    let failed = 0;
    await Promise.all(
      bulk.selectedItems.map((c) =>
        deleteCompany.mutateAsync(c.id).catch(() => {
          failed += 1;
        }),
      ),
    );
    bulk.clear();
    if (failed === 0) {
      toast.success(
        bulk.selectedItems.length === 1
          ? t('companies.toast.deletedOne', 'Deleted {{count}} company', {
              count: bulk.selectedItems.length,
            })
          : t('companies.toast.deletedMany', 'Deleted {{count}} companies', {
              count: bulk.selectedItems.length,
            }),
      );
    } else {
      toast.error(
        failed === 1
          ? t('companies.toast.deleteFailedOne', '{{count}} deletion failed', { count: failed })
          : t('companies.toast.deleteFailedMany', '{{count}} deletions failed', { count: failed }),
      );
    }
  };

  return (
    <div className="space-y-6">
      <header className="page-head flex-wrap">
        <div>
          <h1 className="page-title">{t('companies.title', 'Companies')}</h1>
          <p className="page-sub">
            {items.length === 1
              ? t('companies.subtitleOne', '{{count}} company visible.', { count: items.length })
              : t('companies.subtitleMany', '{{count}} companies visible.', {
                  count: items.length,
                })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SavedViewsBar
            surface="companies"
            basePath="/companies"
            namePlaceholder={t('companies.savedViews.placeholder', 'e.g. "Aerospace targets, A–Z"')}
          />
          <Button variant="secondary" onClick={() => setShowDuplicates(true)}>
            <Icon name="copy" size={14} />
            {t('companies.findDuplicates', 'Find duplicates')}
          </Button>
          {canWrite && (
            <LiquidGlassButton onClick={() => setShowNew(true)}>
              <Icon name="plus" size={14} />
              {t('companies.newCompany', 'New company')}
            </LiquidGlassButton>
          )}
        </div>
      </header>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label={t('companies.summaryAriaLabel', 'Company list summary')}
      >
        {stats.map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <span className="text-xs font-medium text-[var(--fg-tertiary)]">{stat.label}</span>
            <strong className="mt-1 block text-xl font-semibold text-[var(--fg-primary)] tabular-nums">
              {stat.value}
            </strong>
            <span className="text-xs text-[var(--fg-tertiary)]">{stat.detail}</span>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden">
        <div className="card-body flex flex-wrap items-center justify-between gap-3 pt-4">
          <label htmlFor="company-search" className="account-filter min-w-[min(100%,320px)]">
            <Icon name="search" size={14} ariaHidden />
            <input
              id="company-search"
              type="search"
              placeholder={t('companies.searchPlaceholder', 'Search by name or domain…')}
              aria-label={t('companies.searchAriaLabel', 'Search companies')}
              value={inputValue}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('search', e.target.value);
                else next.delete('search');
                setParams(next, { replace: true });
              }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            />
          </label>
          <IntelViewsBar
            view={view}
            direction={direction}
            onView={(v) => setParam('view', v)}
            onDirection={(d) => setParam('direction', d)}
            columns={TOGGLE_COLUMNS.map((c) => ({ key: c.key, label: columnLabel(c) }))}
            isVisible={columns.isVisible}
            onToggleColumn={columns.toggle}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <span role="status" aria-live="polite">
              {searchTerm
                ? items.length === 1
                  ? t('companies.resultsCountOne', '{{count}} result for "{{term}}"', {
                      count: items.length,
                      term: searchTerm,
                    })
                  : t('companies.resultsCountMany', '{{count}} results for "{{term}}"', {
                      count: items.length,
                      term: searchTerm,
                    })
                : t('companies.showingLatest', 'Showing latest 50 companies')}
            </span>
            {searchTerm ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('search');
                  setParams(next, { replace: true });
                }}
              >
                {t('companies.clear', 'Clear')}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {showNew && (
        <NewCompanyDialog
          onClose={() => setShowNew(false)}
          onCreate={async (body) => {
            try {
              await createCompany.mutateAsync({
                name: body.name,
                legalName: null,
                domain: body.domain ?? null,
                industry: body.industry ?? null,
                employeeCount: null,
                countryCode: body.countryCode ?? null,
                address: null,
                billingEmail: null,
                taxId: null,
                logoUrl: null,
                website: null,
              });
              setShowNew(false);
            } catch {
              /* error is surfaced by the mutation toast in the hook */
            }
          }}
          isPending={createCompany.isPending}
        />
      )}

      <DuplicatesDialog entity="company" open={showDuplicates} onOpenChange={setShowDuplicates} />

      <IntelImportProgress batches={imports.data?.items ?? []} />

      <BulkActionBar
        count={bulk.count}
        onExport={exportSelected}
        onDelete={canWrite ? bulkDelete : undefined}
        onClear={bulk.clear}
        isDeleting={deleteCompany.isPending}
      />

      {companies.isLoading ? (
        <LoadingSkeleton rows={8} />
      ) : companies.isError ? (
        <ErrorState
          title={t('companies.error.title', 'Failed to load companies')}
          message={
            companies.error instanceof Error
              ? companies.error.message
              : t('companies.error.fallback', 'Something went wrong')
          }
        />
      ) : !companies.data || companies.data.items.length === 0 ? (
        <EmptyState
          icon={searchTerm ? 'search' : 'building'}
          title={
            searchTerm
              ? t('companies.empty.searchTitle', 'No companies match your search')
              : t('companies.empty.headline', 'No accounts on the radar')
          }
          message={
            searchTerm
              ? t(
                  'companies.empty.searchMessage',
                  'Nothing matched "{{term}}". Try a company name or domain.',
                  { term: searchTerm },
                )
              : t(
                  'companies.empty.body',
                  'Add the companies you bid into. Contacts, intel signals, and every opportunity hang off an account — start with your top target.',
                )
          }
          secondary={
            searchTerm ? null : (
              <EmptyStateLink to="/settings?tab=data-import">
                {t('companies.empty.importCsv', 'Or import accounts from CSV')}
              </EmptyStateLink>
            )
          }
          action={
            searchTerm ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('search');
                  setParams(next, { replace: true });
                }}
              >
                {t('companies.empty.clearSearch', 'Clear search')}
              </Button>
            ) : (
              canWrite && (
                <Button size="sm" onClick={() => setShowNew(true)}>
                  {t('companies.empty.addCompany', 'Add company')}
                </Button>
              )
            )
          }
        />
      ) : (
        <Card className="overflow-hidden p-3">
          <SpotlightTable
            query={searchTerm}
            minWidth={1640}
            className="[&_tr[data-selected=true]]:bg-[var(--brand-primary-tint)]/60"
          >
            <thead>
              <tr>
                <th className="w-10">
                  <label className="table-checkbox-hit">
                    <span className="sr-only">
                      {bulk.allSelected
                        ? t('companies.table.deselectAll', 'Deselect all')
                        : t('companies.table.selectAll', 'Select all')}
                    </span>
                    <input
                      type="checkbox"
                      checked={bulk.allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = bulk.someSelected;
                      }}
                      onChange={() => bulk.toggleAll(items)}
                      className="cursor-pointer accent-[var(--brand-primary)]"
                    />
                  </label>
                </th>
                <th scope="col" aria-sort={getSortableHeaderAriaSort('name', sortState)}>
                  <SortableHeader columnKey="name" state={sortState} onChange={setSortState}>
                    {t('companies.table.company', 'Company')}
                  </SortableHeader>
                </th>
                {TOGGLE_COLUMNS.filter((c) => columns.isVisible(c.key)).map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-label={columnLabel(c)}
                    aria-sort={getSortableHeaderAriaSort(c.key, sortState)}
                    className="whitespace-nowrap"
                  >
                    <SortableHeader columnKey={c.key} state={sortState} onChange={setSortState}>
                      {columnLabel(c)}
                    </SortableHeader>
                  </th>
                ))}
                <th scope="col" className="text-right">
                  {t('companies.table.actions', 'Actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  selected={bulk.isSelected(c.id)}
                  onToggle={bulk.toggleOne}
                  onDelete={deleteCompany.mutate}
                  canDelete={canWrite}
                  query={searchTerm}
                  isVisible={columns.isVisible}
                />
              ))}
            </tbody>
          </SpotlightTable>
          <CursorPager
            currentPage={pager.page}
            hasNext={Boolean(companies.data?.nextCursor)}
            hasPrevious={pager.hasPrevious}
            isLoading={companies.isLoading}
            itemCount={items.length}
            label="companies"
            onNext={() => pager.goNext(companies.data?.nextCursor)}
            onPrevious={pager.goPrevious}
          />
        </Card>
      )}
    </div>
  );
}
