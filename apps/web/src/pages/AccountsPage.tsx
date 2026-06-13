import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState } from 'react';

import { SmartCompanyDialog } from '@/components/company/SmartCompanyDialog';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useAutopopulateSalesCompanies } from '@/hooks/useAutopopulateSalesCompanies';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft } from '@/lib/motion';

import { AccountCard } from './accountsPage/AccountCard';
import { IntegrationMotionRail, SourceStat } from './accountsPage/AccountDashboardWidgets';
import { deriveAccount, sortRows, titleCase, type SortKey } from './accountsPage/accountUtils';

export function AccountsPage() {
  const { formatMoneyMicros } = useFormatMoney();
  const dashboard = useCrmDashboard();
  const autopopulate = useAutopopulateSalesCompanies();
  const reducedMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('pipeline');
  const syncError = autopopulate.error instanceof Error ? autopopulate.error.message : null;

  const rows = useMemo(() => {
    if (!dashboard.data) return [];
    return dashboard.data.companies
      .map((company) => deriveAccount(company, dashboard.data!.deals))
      .filter((row) => {
        if (industry && row.company.industry !== industry) return false;
        if (search) {
          const needle = search.toLowerCase();
          return (
            row.company.name.toLowerCase().includes(needle) ||
            (row.company.domain ?? '').toLowerCase().includes(needle)
          );
        }
        return true;
      })
      .sort((a, b) => sortRows(a, b, sort));
  }, [dashboard.data, search, industry, sort]);

  // Memoize aggregate stats so they don't recompute on every render
  // (rows is already memoized — this just avoids four extra O(n) passes).
  const summaryStats = useMemo(
    () => ({
      totalPipeline: rows.reduce((acc, r) => acc + r.pipelineMicros, 0),
      totalOpen: rows.reduce((acc, r) => acc + r.openDeals, 0),
      logoCoverage: rows.filter((r) => Boolean(r.company.logo?.url)).length,
      enrichedAccounts: rows.filter((r) => r.company.source === 'verified_data').length,
    }),
    [rows],
  );

  const industries = useMemo(() => {
    if (!dashboard.data) return [];
    return [
      ...new Set(
        dashboard.data.companies.map((c) => c.industry).filter((i): i is string => Boolean(i)),
      ),
    ].sort();
  }, [dashboard.data]);

  if (dashboard.isLoading) {
    return (
      <>
        <h1 className="sr-only">Accounts</h1>
        <LoadingSkeleton rows={10} />
      </>
    );
  }
  if (dashboard.isError) {
    return (
      <>
        <h1 className="sr-only">Accounts</h1>
        <ErrorState
          title="Couldn't load accounts"
          message={dashboard.error?.message ?? 'The dashboard endpoint did not respond.'}
        />
      </>
    );
  }
  if (!dashboard.data) {
    return (
      <>
        <h1 className="sr-only">Accounts</h1>
        <EmptyState title="No accounts yet" />
      </>
    );
  }

  const { totalPipeline, totalOpen, logoCoverage, enrichedAccounts } = summaryStats;
  const healthyProviders = dashboard.data.providerHealth.filter(
    (p) => p.status === 'healthy',
  ).length;
  const providerCount = dashboard.data.providerHealth.length;

  const syncErpAccounts = () => {
    autopopulate.mutate(
      { limit: 20 },
      {
        onError: (error) => {
          toast.error('ERP account sync failed', {
            description:
              error instanceof Error
                ? error.message
                : 'The latest ERP customer pull could not complete.',
            action: { label: 'Retry', onClick: syncErpAccounts },
          });
        },
      },
    );
  };

  return (
    <>
      <motion.div
        className="page-head motion-page-head"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(6px)' }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={springSoft}
      >
        <div>
          <h1 className="page-title gradient-text">Accounts</h1>
          <div className="page-sub">
            {rows.length} {rows.length === 1 ? 'company' : 'companies'} · {totalOpen} open deals ·{' '}
            {formatMoneyMicros(totalPipeline, 'EUR')} weighted pipeline
          </div>
        </div>
        <div className="page-actions">
          {autopopulate.data ? (
            <div className="account-sync-result">
              {autopopulate.data.enriched} enriched / {autopopulate.data.cached} cached
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={autopopulate.isPending}
            onClick={syncErpAccounts}
            title="Sync top ERP sale.order customers into verified BidStack accounts"
          >
            {autopopulate.isPending ? (
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                aria-hidden
              />
            ) : (
              <Icon name="download" size={14} />
            )}
            {autopopulate.isPending ? 'Syncing...' : 'Sync ERP accounts'}
          </button>
          <SmartCompanyDialog
            trigger={
              <button type="button" className="btn btn-primary">
                <Icon name="plus" size={14} />
                New account
              </button>
            }
          />
        </div>
      </motion.div>

      {autopopulate.isError ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-tint)] px-4 py-3 text-sm"
        >
          <div>
            <div className="font-semibold text-[var(--danger)]">ERP account sync failed</div>
            <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">
              {syncError ?? 'The last sync could not pull the top 20 ERP customers.'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={autopopulate.isPending}
            onClick={syncErpAccounts}
          >
            Retry sync
          </button>
        </div>
      ) : null}

      <section className="account-dashboard-strip" aria-label="Account source coverage">
        <SourceStat label="Accounts" value={rows.length.toLocaleString()} detail="portfolio" />
        <SourceStat
          label="Open deals"
          value={totalOpen.toLocaleString()}
          detail="External CRM pipeline"
        />
        <SourceStat
          label="Weighted pipeline"
          value={formatMoneyMicros(totalPipeline, 'EUR')}
          detail="bid and presales"
        />
        <SourceStat
          label="Logo coverage"
          value={`${logoCoverage}/${rows.length || 0}`}
          detail="brand assets"
        />
        <SourceStat
          label="Enriched profiles"
          value={enrichedAccounts.toLocaleString()}
          detail="verified data cache"
        />
        <SourceStat
          label="Sources healthy"
          value={`${healthyProviders}/${providerCount}`}
          detail="API mesh"
        />
      </section>
      <IntegrationMotionRail
        providers={dashboard.data.providerHealth.map((provider) => ({
          name: provider.provider,
          status: provider.status,
        }))}
      />

      <motion.section
        className="card account-filter-card"
        aria-label="Filters"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSoft, delay: reducedMotion ? 0 : 0.08 }}
      >
        <div className="card-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="account-filter" aria-label="Search">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Search by name or domain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="account-filter" aria-label="Industry">
            <Icon name="briefcase" size={14} />
            <select value={industry ?? ''} onChange={(e) => setIndustry(e.target.value || null)}>
              <option value="">All industries</option>
              {industries.map((ind) => (
                <option key={ind} value={ind}>
                  {titleCase(ind)}
                </option>
              ))}
            </select>
          </label>
          <label className="account-filter" aria-label="Sort">
            <Icon name="reports" size={14} />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="pipeline">Sort: pipeline value</option>
              <option value="name">Sort: name</option>
              <option value="health">Sort: health</option>
              <option value="industry">Sort: industry</option>
            </select>
          </label>
        </div>
      </motion.section>

      {/* sr-only live region — announces filter/search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {`${rows.length} account${rows.length === 1 ? '' : 's'}${search ? ` matching "${search}"` : ''}`}
      </p>

      {rows.length === 0 ? (
        <EmptyState title="No accounts match your filters" />
      ) : (
        <motion.section
          className="account-grid"
          aria-label="Account cards"
          // Animate filter changes — surviving cards glide to new positions
          // while removed cards fade. Matches the macOS Stocks watchlist
          // reorder animation.
          layout
        >
          {rows.map((row, i) => (
            <AccountCard key={row.company.id} row={row} index={i} />
          ))}
        </motion.section>
      )}
    </>
  );
}
