import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SmartCompanyDialog } from '@/components/company/SmartCompanyDialog';
import { CursorPager } from '@/components/ui/CursorPager';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useAutopopulateSalesCompanies } from '@/hooks/useAutopopulateSalesCompanies';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft } from '@/lib/motion';

import { AccountCard } from './AccountCard';
import { IntegrationMotionRail } from './AccountDashboardWidgets';
import { FilterRow, FilterSelect, InsightPanel, SegmentHeader, StatTile } from './AccountsChrome';
import { isSyntheticAccountName } from './testDataFilter';
import {
  deriveAccount,
  segmentMatches,
  sortRows,
  titleCase,
  type AccountSegmentKey,
  type SortKey,
} from './accountUtils';

// Cap the number of account cards mounted at once. The dashboard payload is
// already server-bounded (top opportunities + enrichments), but the card grid
// derives + mounts one animated card per row — at scale that DOM is the cost.
// Render a bounded page rather than every derived row in one paint.
const ACCOUNTS_PAGE_SIZE = 30;

// The /crm/dashboard snapshot is server-bounded: its `companies` array is built
// from the most-recent opportunities (take:100) + company enrichments (take:200)
// in dashboard.service.ts, deduped by name — so it is NOT the full company table
// and carries no total. This "All accounts" view searches/filters entirely
// client-side over that array, so an account outside the snapshot is unreachable
// and a search for it wrongly reads as "record absent". The endpoint takes no
// search/limit param (server-side account search is the real follow-up fix), so
// the honest interim is to make the cap visible once the payload is large enough
// to be truncated. Threshold is the enrichment take:200 ceiling — reaching it
// means a source is at its cap and more accounts almost certainly exist beyond
// the snapshot. Kept conservative so small orgs (whose snapshot IS complete) are
// never falsely warned.
const SNAPSHOT_ACCOUNT_CAP = 200;

export function AccountsAllSegment() {
  const { t } = useTranslation('crm');
  const { formatMoneyMicros } = useFormatMoney();
  const dashboard = useCrmDashboard();
  const autopopulate = useAutopopulateSalesCompanies();
  const reducedMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<string | null>(null);
  const [segment, setSegment] = useState<AccountSegmentKey>('all');
  const [technology, setTechnology] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('pipeline');
  const [page, setPage] = useState(0);
  const syncError = autopopulate.error instanceof Error ? autopopulate.error.message : null;

  const allRows = useMemo(() => {
    if (!dashboard.data) return [];
    // Hide synthetic E2E/test-fixture accounts (SCOPE-*, KAMDraft-*, E2E …) from
    // this customer-facing view, matching the Key/Top segments. A polluted demo
    // org should not surface test residue; fresh orgs seed none.
    return dashboard.data.companies
      .filter((company) => !isSyntheticAccountName(company.name))
      .map((company) => deriveAccount(company, dashboard.data!.deals));
  }, [dashboard.data]);

  const rows = useMemo(() => {
    return allRows
      .filter((row) => {
        if (industry && row.company.industry !== industry) return false;
        if (!segmentMatches(row, segment)) return false;
        if (
          technology &&
          !(row.company.technicalStack ?? []).some(
            (category) =>
              category.label === technology ||
              category.items.some((item) => item.name === technology),
          )
        ) {
          return false;
        }
        if (search) {
          const needle = search.toLowerCase();
          return (
            row.company.name.toLowerCase().includes(needle) ||
            (row.company.domain ?? '').toLowerCase().includes(needle) ||
            (row.company.industry ?? '').toLowerCase().includes(needle) ||
            (row.company.technicalStack ?? []).some(
              (category) =>
                category.label.toLowerCase().includes(needle) ||
                category.items.some((item) => item.name.toLowerCase().includes(needle)),
            )
          );
        }
        return true;
      })
      .sort((a, b) => sortRows(a, b, sort));
  }, [allRows, search, industry, segment, technology, sort]);

  // Reset to the first page whenever the filtered/sorted view changes, without an
  // effect — the react-hooks linter rejects effect-driven resets, so the active
  // page is clamped in render (mirrors useCursorPagination's token-reset pattern).
  const pageToken = `${search} ${industry} ${segment} ${technology} ${sort}`;
  const [pageTokenState, setPageTokenState] = useState(pageToken);
  const activePage = pageTokenState === pageToken ? page : 0;
  const pageCount = Math.max(1, Math.ceil(rows.length / ACCOUNTS_PAGE_SIZE));
  const clampedPage = Math.min(activePage, pageCount - 1);
  const pagedRows = useMemo(
    () => rows.slice(clampedPage * ACCOUNTS_PAGE_SIZE, (clampedPage + 1) * ACCOUNTS_PAGE_SIZE),
    [rows, clampedPage],
  );
  const goToPage = (next: number) => {
    setPageTokenState(pageToken);
    setPage(next);
  };

  // Memoize aggregate stats so they don't recompute on every render
  // (rows is already memoized — this just avoids four extra O(n) passes).
  const summaryStats = useMemo(
    () => ({
      totalPipeline: rows.reduce((acc, r) => acc + r.pipelineMicros, 0),
      totalOpen: rows.reduce((acc, r) => acc + r.openDeals, 0),
      logoCoverage: rows.filter((r) => Boolean(r.company.logo?.url)).length,
      enrichedAccounts: rows.filter((r) => r.company.source === 'verified_data').length,
      techAccounts: rows.filter((r) => (r.company.technicalStack?.length ?? 0) > 0).length,
      avgCoverage:
        rows.length > 0
          ? Math.round(rows.reduce((acc, r) => acc + r.coverage.score, 0) / rows.length)
          : 0,
    }),
    [rows],
  );

  const segmentCounts = useMemo(
    () => ({
      all: allRows.length,
      enriched: allRows.filter((row) => segmentMatches(row, 'enriched')).length,
      with_tech: allRows.filter((row) => segmentMatches(row, 'with_tech')).length,
      needs_data: allRows.filter((row) => segmentMatches(row, 'needs_data')).length,
      watch: allRows.filter((row) => segmentMatches(row, 'watch')).length,
    }),
    [allRows],
  );

  const industries = useMemo(() => {
    if (!dashboard.data) return [];
    return [
      ...new Set(
        dashboard.data.companies.map((c) => c.industry).filter((i): i is string => Boolean(i)),
      ),
    ].sort();
  }, [dashboard.data]);

  const technologyOptions = useMemo(() => {
    const options = new Set<string>();
    for (const row of allRows) {
      for (const category of row.company.technicalStack ?? []) {
        options.add(category.label);
        for (const item of category.items) options.add(item.name);
      }
    }
    return [...options].sort();
  }, [allRows]);

  const healthDistribution = useMemo(
    () => [
      { key: 'strong', label: t('accounts.health.strong', 'Strong'), count: rows.filter((row) => row.health === 'strong').length },
      { key: 'good', label: t('accounts.health.good', 'Good'), count: rows.filter((row) => row.health === 'good').length },
      {
        key: 'needs_attention',
        label: t('accounts.health.watch', 'Watch'),
        count: rows.filter((row) => row.health === 'needs_attention').length,
      },
      { key: 'critical', label: t('accounts.health.risk', 'At risk'), count: rows.filter((row) => row.health === 'critical').length },
    ],
    [rows, t],
  );

  const topMissingFields = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const missing of row.coverage.missing) {
        counts.set(missing, (counts.get(missing) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [rows]);

  if (dashboard.isLoading) {
    return (
      <>
        <h1 className="sr-only">{t('accounts.title', 'Accounts')}</h1>
        <LoadingSkeleton rows={10} />
      </>
    );
  }
  if (dashboard.isError) {
    return (
      <>
        <h1 className="sr-only">{t('accounts.title', 'Accounts')}</h1>
        <ErrorState
          title={t('accounts.error.title', "Couldn't load accounts")}
          message={
            dashboard.error?.message ??
            t('accounts.error.message', 'The dashboard endpoint did not respond.')
          }
        />
      </>
    );
  }
  if (!dashboard.data) {
    return (
      <>
        <h1 className="sr-only">{t('accounts.title', 'Accounts')}</h1>
        <EmptyState title={t('accounts.empty.title', 'No accounts yet')} />
      </>
    );
  }

  const { totalPipeline, totalOpen, logoCoverage, enrichedAccounts, techAccounts, avgCoverage } = summaryStats;
  const healthyProviders = dashboard.data.providerHealth.filter(
    (p) => p.status === 'healthy',
  ).length;
  const providerCount = dashboard.data.providerHealth.length;
  // Raw payload size (pre synthetic-name filter) — reflects the server cap
  // directly, so the caveat tracks the snapshot bound rather than demo-org noise.
  const loadedAccountCount = dashboard.data.companies.length;
  const snapshotCapped = loadedAccountCount >= SNAPSHOT_ACCOUNT_CAP;
  const filtersActive = Boolean(search || industry || technology || segment !== 'all');

  const syncErpAccounts = () => {
    autopopulate.mutate(
      { limit: 20 },
      {
        onError: (error) => {
          toast.error(t('accounts.sync.errorTitle', 'ERP account sync failed'), {
            description:
              error instanceof Error
                ? error.message
                : t('accounts.sync.errorDescription', 'The latest ERP customer pull could not complete.'),
            action: { label: t('accounts.actions.retry', 'Retry'), onClick: syncErpAccounts },
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(6px)' }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={springSoft}
      >
        <SegmentHeader
          title={t('accounts.title', 'Accounts')}
          subtitle={
            <>
              {rows.length === 1
                ? t('accounts.summary.companyCount_one', '{{count}} company', { count: rows.length })
                : t('accounts.summary.companyCount_other', '{{count}} companies', {
                    count: rows.length,
                  })}{' '}
              · {t('accounts.summary.openDeals', '{{count}} open deals', { count: totalOpen })} ·{' '}
              {t('accounts.summary.weightedPipeline', '{{amount}} weighted pipeline', {
                amount: formatMoneyMicros(totalPipeline, 'EUR'),
              })}
            </>
          }
          actions={
            <>
              {autopopulate.data ? (
                <div className="account-sync-result">
                  {t('accounts.sync.result', '{{enriched}} enriched / {{cached}} cached', {
                    enriched: autopopulate.data.enriched,
                    cached: autopopulate.data.cached,
                  })}
                </div>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={autopopulate.isPending}
                onClick={syncErpAccounts}
                title={t(
                  'accounts.sync.buttonTitle',
                  'Sync top ERP sale.order customers into verified Polo PreSales accounts',
                )}
              >
                {autopopulate.isPending ? (
                  <span
                    className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                    aria-hidden
                  />
                ) : (
                  <Icon name="download" size={14} />
                )}
                {autopopulate.isPending
                  ? t('accounts.sync.inProgress', 'Syncing...')
                  : t('accounts.sync.button', 'Sync ERP accounts')}
              </button>
              <SmartCompanyDialog
                trigger={
                  <button type="button" className="btn btn-primary">
                    <Icon name="plus" size={14} />
                    {t('accounts.actions.newAccount', 'New account')}
                  </button>
                }
              />
            </>
          }
        />
      </motion.div>

      {autopopulate.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-tint)] px-4 py-3 text-sm"
        >
          <div>
            <div className="font-semibold text-[var(--danger)]">
              {t('accounts.sync.errorTitle', 'ERP account sync failed')}
            </div>
            <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">
              {syncError ??
                t(
                  'accounts.sync.alertFallback',
                  'The last sync could not pull the top 20 ERP customers.',
                )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={autopopulate.isPending}
            onClick={syncErpAccounts}
          >
            {t('accounts.sync.retry', 'Retry sync')}
          </button>
        </div>
      ) : null}

      <section
        aria-label={t('accounts.stats.regionLabel', 'Account source coverage')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        <StatTile
          label={t('accounts.stats.accounts.label', 'Accounts')}
          value={rows.length.toLocaleString()}
          sublabel={t('accounts.stats.accounts.detail', 'portfolio')}
        />
        <StatTile
          label={t('accounts.stats.openDeals.label', 'Open deals')}
          value={totalOpen.toLocaleString()}
          sublabel={t('accounts.stats.openDeals.detail', 'External CRM pipeline')}
        />
        <StatTile
          label={t('accounts.stats.weightedPipeline.label', 'Weighted pipeline')}
          value={formatMoneyMicros(totalPipeline, 'EUR')}
          sublabel={t('accounts.stats.weightedPipeline.detail', 'bid and presales')}
        />
        <StatTile
          label={t('accounts.stats.coverage.label', 'Avg coverage')}
          value={`${avgCoverage}%`}
          sublabel={t('accounts.stats.coverage.detail', '{{logos}} logos / {{tech}} tech', {
            logos: logoCoverage,
            tech: techAccounts,
          })}
        />
        <StatTile
          label={t('accounts.stats.enrichedProfiles.label', 'Enriched profiles')}
          value={enrichedAccounts.toLocaleString()}
          sublabel={t('accounts.stats.enrichedProfiles.detail', 'verified data cache')}
        />
        <StatTile
          label={t('accounts.stats.sourcesHealthy.label', 'Sources healthy')}
          value={`${healthyProviders}/${providerCount}`}
          sublabel={t('accounts.stats.sourcesHealthy.detail', 'API mesh')}
        />
      </section>
      <IntegrationMotionRail
        providers={dashboard.data.providerHealth.map((provider) => ({
          name: provider.provider,
          status: provider.status,
        }))}
      />

      <InsightPanel
        ariaLabel={t('accounts.experience.regionLabel', 'Portfolio cockpit')}
        eyebrow={t('accounts.experience.eyebrow', 'Portfolio cockpit')}
        heading={t('accounts.experience.title', '{{count}} accounts in view', { count: rows.length })}
        sub={
          topMissingFields.length > 0
            ? t('accounts.experience.gaps', 'Top gaps: {{gaps}}', {
                gaps: topMissingFields.map(([name, count]) => `${name} (${count})`).join(', '),
              })
            : t('accounts.experience.complete', 'No coverage gaps in the current view.')
        }
      >
        <div className="account-health-bars">
          {healthDistribution.map((item) => {
            const width = rows.length > 0 ? `${Math.round((item.count / rows.length) * 100)}%` : '0%';
            return (
              <div key={item.key} className={`account-health-bar account-health-${item.key}`}>
                <div>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </div>
                <span aria-hidden>
                  <i style={{ width }} />
                </span>
              </div>
            );
          })}
        </div>
      </InsightPanel>

      <motion.div
        className="space-y-3"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSoft, delay: reducedMotion ? 0 : 0.08 }}
      >
        <div className="account-segment-bar" role="group" aria-label={t('accounts.segments.label', 'Account segments')}>
          {[
            { key: 'all', label: t('accounts.segments.all', 'All'), count: segmentCounts.all },
            { key: 'enriched', label: t('accounts.segments.enriched', 'Enriched'), count: segmentCounts.enriched },
            { key: 'with_tech', label: t('accounts.segments.withTech', 'Tech stack'), count: segmentCounts.with_tech },
            { key: 'needs_data', label: t('accounts.segments.needsData', 'Needs data'), count: segmentCounts.needs_data },
            { key: 'watch', label: t('accounts.segments.watch', 'Watch'), count: segmentCounts.watch },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={segment === option.key}
              className={segment === option.key ? 'is-active' : ''}
              onClick={() => setSegment(option.key as AccountSegmentKey)}
            >
              <span>{option.label}</span>
              <strong>{option.count}</strong>
            </button>
          ))}
        </div>
        <FilterRow
          ariaLabel={t('accounts.filters.regionLabel', 'Filters')}
          searchId="all-accounts-search"
          searchLabel={t('accounts.filters.search.label', 'Search')}
          searchPlaceholder={t('accounts.filters.search.placeholder', 'Search by name or domain…')}
          searchValue={search}
          onSearchChange={setSearch}
          onReset={() => {
            setSearch('');
            setIndustry(null);
            setTechnology(null);
            setSegment('all');
          }}
          resetLabel={t('accounts.filters.reset', 'Reset')}
          showReset={Boolean(search || industry || technology || segment !== 'all')}
        >
          <FilterSelect
            ariaLabel={t('accounts.filters.industry.label', 'Industry')}
            value={industry ?? ''}
            onChange={(value) => setIndustry(value || null)}
          >
            <option value="">{t('accounts.filters.industry.all', 'All industries')}</option>
            {industries.map((ind) => (
              <option key={ind} value={ind}>
                {titleCase(ind)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            ariaLabel={t('accounts.filters.technology.label', 'Technology')}
            value={technology ?? ''}
            onChange={(value) => setTechnology(value || null)}
          >
            <option value="">{t('accounts.filters.technology.all', 'All technologies')}</option>
            {technologyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            ariaLabel={t('accounts.filters.sort.label', 'Sort')}
            value={sort}
            onChange={(value) => setSort(value as SortKey)}
          >
            <option value="pipeline">
              {t('accounts.filters.sort.pipeline', 'Sort: pipeline value')}
            </option>
            <option value="name">{t('accounts.filters.sort.name', 'Sort: name')}</option>
            <option value="health">{t('accounts.filters.sort.health', 'Sort: health')}</option>
            <option value="industry">{t('accounts.filters.sort.industry', 'Sort: industry')}</option>
            <option value="coverage">{t('accounts.filters.sort.coverage', 'Sort: coverage')}</option>
          </FilterSelect>
        </FilterRow>
      </motion.div>

      {/* sr-only live region — announces filter/search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {search
          ? rows.length === 1
            ? t('accounts.liveRegion.matching_one', '{{count}} account matching "{{query}}"', {
                count: rows.length,
                query: search,
              })
            : t('accounts.liveRegion.matching_other', '{{count}} accounts matching "{{query}}"', {
                count: rows.length,
                query: search,
              })
          : rows.length === 1
            ? t('accounts.liveRegion.count_one', '{{count}} account', { count: rows.length })
            : t('accounts.liveRegion.count_other', '{{count}} accounts', { count: rows.length })}
      </p>

      {snapshotCapped ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--fg-secondary)]"
        >
          <Icon name="info" size={14} />
          {t(
            'accounts.cap.notice',
            'Showing your most active {{count}} accounts from the live dashboard — this view can’t list the full portfolio yet. Search filters the accounts loaded here; use global search to open one that isn’t. Full account search is on the roadmap.',
            { count: loadedAccountCount },
          )}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={t('accounts.empty.filtered', 'No accounts match your filters')}
          message={
            snapshotCapped && filtersActive
              ? t(
                  'accounts.empty.filteredCapped',
                  'This view searches only the accounts loaded from your live dashboard. The account you’re after may exist outside it — try global search.',
                )
              : undefined
          }
        />
      ) : (
        <>
          <motion.section
            className="account-grid"
            aria-label={t('accounts.grid.regionLabel', 'Account cards')}
            // Animate filter changes — surviving cards glide to new positions
            // while removed cards fade. Matches the macOS Stocks watchlist
            // reorder animation.
            layout
          >
            {pagedRows.map((row, i) => (
              <AccountCard key={row.company.id} row={row} index={i} />
            ))}
          </motion.section>
          {pageCount > 1 ? (
            <CursorPager
              currentPage={clampedPage + 1}
              hasNext={clampedPage < pageCount - 1}
              hasPrevious={clampedPage > 0}
              itemCount={pagedRows.length}
              label={t('accounts.paginationLabel', 'accounts')}
              onNext={() => goToPage(clampedPage + 1)}
              onPrevious={() => goToPage(clampedPage - 1)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
