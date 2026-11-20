// Key Accounts — strategically important accounts flagged by admins.
// Paginated list (≤50/page) with pipeline, contacts, and proactive alerts.
// The KPI strip totals are scoped to the current page, not the whole portfolio.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { KeyAccountBadge } from '@/components/company/AccountTierBadges';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { CursorPager } from '@/components/ui/CursorPager';
import { useKeyAccounts, useAccountIndustries } from '@/hooks/useKeyAccounts';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft, staggerChild, staggerParent } from '@/lib/motion';

import { FilterRow, FilterSelect, InsightPanel, SegmentHeader, StatTile } from './AccountsChrome';
import { isSyntheticAccountName } from './testDataFilter';

import { StrategicSignalInsight } from './StrategicSignalInsight';
import { keyAccountSignal } from './strategicSignals';

const KEY_ACCOUNTS_PAGE_SIZE = 50;
const KEY_ACCOUNTS_SIGNAL_SIZE = 200;

export function AccountsKeySegment() {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<string>('');
  const { formatMoney } = useFormatMoney();
  // Debounce the value that feeds the query keys so a server fetch fires once the
  // user pauses typing — not on every keystroke. `search` still drives the input
  // display for responsive typing.
  const debouncedSearch = useDebouncedValue(search, 250);
  const pager = useCursorPagination(`${debouncedSearch}\u0000${industry}`);

  const industries = useAccountIndustries();
  const accounts = useKeyAccounts({
    search: debouncedSearch || undefined,
    industry: industry || undefined,
    limit: KEY_ACCOUNTS_PAGE_SIZE,
    cursor: pager.cursor,
  });
  const signalAccounts = useKeyAccounts({
    search: debouncedSearch || undefined,
    limit: KEY_ACCOUNTS_SIGNAL_SIZE,
  });

  // Hide synthetic E2E/fixture accounts from the customer-facing view.
  const items = useMemo(
    () => (accounts.data?.items ?? []).filter((a) => !isSyntheticAccountName(a.name)),
    [accounts.data?.items],
  );
  const signalItems = useMemo(
    () => (signalAccounts.data?.items ?? items).filter((a) => !isSyntheticAccountName(a.name)),
    [items, signalAccounts.data?.items],
  );
  const unclassifiedIndustry = t('keyAccounts.unclassifiedIndustry', 'Unclassified');
  const accountError = accounts.error instanceof Error ? accounts.error.message : undefined;
  const industryError = industries.error instanceof Error ? industries.error.message : undefined;
  const totalPipeline = useMemo(
    () => items.reduce((sum, account) => sum + account.totalValue, 0),
    [items],
  );
  const openDeals = useMemo(() => items.reduce((sum, account) => sum + account.openDeals, 0), [items]);
  const contactCount = useMemo(
    () => items.reduce((sum, account) => sum + account.contactCount, 0),
    [items],
  );
  const opportunityCount = useMemo(
    () => items.reduce((sum, account) => sum + account.opportunityCount, 0),
    [items],
  );
  const industryBreakdown = useMemo(() => {
    const byIndustry = new Map<string, { count: number; pipeline: number }>();
    for (const account of signalItems) {
      const key = account.industry || unclassifiedIndustry;
      const current = byIndustry.get(key) ?? { count: 0, pipeline: 0 };
      current.count += 1;
      current.pipeline += account.totalValue;
      byIndustry.set(key, current);
    }
    return [...byIndustry.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.pipeline - a.pipeline || b.count - a.count)
      .slice(0, 6);
  }, [signalItems, unclassifiedIndustry]);
  const maxIndustryPipeline = Math.max(1, ...industryBreakdown.map((item) => item.pipeline));
  const selectedIndustryStats = industryBreakdown.find((item) => item.name === industry);
  const leadingIndustry = selectedIndustryStats ?? industryBreakdown[0] ?? null;

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header variants={reducedMotion ? undefined : staggerChild}>
        <SegmentHeader
          title={t('keyAccounts.title', 'Strategic Accounts')}
          subtitle={t(
            'keyAccounts.subtitle',
            'Regional strategic accounts owned for pipeline, coverage, and executive follow-through — distinct from the curated global Top 10.',
          )}
        />
      </motion.header>

      {/* Filters */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <FilterRow
          ariaLabel={t('keyAccounts.filtersAria', 'Key account filters')}
          searchId="key-accounts-search"
          searchLabel={t('keyAccounts.searchLabel', 'Search key accounts')}
          searchPlaceholder={t('keyAccounts.searchPlaceholder', 'Search key accounts...')}
          searchValue={search}
          onSearchChange={setSearch}
          onReset={() => {
            setSearch('');
            setIndustry('');
          }}
          resetLabel={t('keyAccounts.resetFilters', 'Reset')}
          showReset={Boolean(search || industry)}
        >
          <FilterSelect
            id="key-accounts-industry"
            ariaLabel={t('keyAccounts.industryFilterLabel', 'Filter key accounts by industry')}
            ariaDescribedBy={industries.isError ? 'key-accounts-industry-error' : undefined}
            value={industry}
            onChange={setIndustry}
          >
            <option value="">
              {industries.isError
                ? t('keyAccounts.industriesUnavailable', 'Industries unavailable')
                : t('keyAccounts.allIndustries', 'All industries')}
            </option>
            {(industries.data?.items ?? []).map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </FilterSelect>
          {industries.isError ? (
            <div
              id="key-accounts-industry-error"
              role="alert"
              className="flex items-center gap-2 text-xs text-[var(--danger)]"
            >
              <span>
                {industryError ??
                  t('keyAccounts.industryFilterError', 'Could not load industry filters.')}
              </span>
              <button
                type="button"
                className="rounded-md px-2 py-1 font-semibold text-[var(--danger)] hover:bg-[var(--danger-tint)]"
                onClick={() => void industries.refetch()}
              >
                {t('keyAccounts.retry', 'Retry')}
              </button>
            </div>
          ) : null}
        </FilterRow>
      </motion.div>

      {!accounts.isError && industryBreakdown.length > 0 ? (
        <motion.div variants={reducedMotion ? undefined : staggerChild}>
          <InsightPanel
            ariaLabel={t('keyAccounts.industrySignalLabel', 'Key account industry signal')}
            eyebrow={t('keyAccounts.industrySignalEyebrow', 'Industry signal')}
            heading={
              leadingIndustry
                ? t('keyAccounts.industrySignalTitle', '{{industry}} leads the view', {
                    industry: leadingIndustry.name,
                  })
                : t('keyAccounts.industrySignalFallback', 'No industry signal')
            }
            sub={
              leadingIndustry
                ? t('keyAccounts.industrySignalDetail', '{{count}} accounts / {{pipeline}} pipeline', {
                    count: leadingIndustry.count,
                    pipeline: formatMoney(leadingIndustry.pipeline, 'EUR'),
                  })
                : t('keyAccounts.industrySignalEmpty', 'Add industries to companies to unlock the split.')
            }
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {industryBreakdown.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  aria-label={t('keyAccounts.filterByIndustry', 'Filter key accounts by {{industry}}', {
                    industry: item.name,
                  })}
                  aria-pressed={industry === item.name}
                  onClick={() => setIndustry(industry === item.name ? '' : item.name)}
                  className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 text-left transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                >
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-semibold text-[var(--fg-primary)]">{item.name}</span>
                    <span className="font-medium text-[var(--fg-tertiary)]">{item.count}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                    <motion.span
                      className="block h-full rounded-full bg-[var(--brand-primary)]"
                      initial={reducedMotion ? false : { width: 0 }}
                      animate={{ width: `${Math.max(8, Math.round((item.pipeline / maxIndustryPipeline) * 100))}%` }}
                      transition={springSoft}
                    />
                  </div>
                </button>
              ))}
            </div>
          </InsightPanel>
        </motion.div>
      ) : null}

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!accounts.isLoading && accounts.data
          ? `${
              items.length === 1
                ? t('keyAccounts.resultCount_one', '{{count}} account', { count: items.length })
                : t('keyAccounts.resultCount_other', '{{count}} accounts', { count: items.length })
            }${industry ? ` · ${industry}` : ''}`
          : ''}
      </p>

      {/* Stats strip — totals are scoped to the accounts on the CURRENT page,
          not the whole portfolio. GET /api/accounts/key is cursor-paginated
          (≤50/page) and returns no org-wide aggregate, so summing `items`
          (this page) and labelling it a portfolio total would silently
          under-report and shift as the user pages. The 'On this page' eyebrow
          makes the page-scope explicit rather than overclaiming. */}
      {!accounts.isError ? (
        <motion.section
          variants={reducedMotion ? undefined : staggerChild}
          aria-label={t('keyAccounts.statsStripAria', 'Key account totals on this page')}
          className="space-y-2"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
            {t('keyAccounts.statsScope', 'On this page')}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile
              label={t('keyAccounts.statKeyAccounts', 'Key accounts')}
              value={items.length.toLocaleString()}
            />
            <StatTile
              label={t('keyAccounts.statTotalPipeline', 'Total pipeline')}
              value={formatMoney(totalPipeline, 'EUR')}
            />
            <StatTile
              label={t('keyAccounts.statOpenDeals', 'Open deals')}
              value={openDeals.toLocaleString()}
            />
            <StatTile
              label={t('keyAccounts.statContacts', 'Contacts')}
              value={contactCount.toLocaleString()}
            />
            <StatTile
              label={t('keyAccounts.statOpportunities', 'Opportunities')}
              value={opportunityCount.toLocaleString()}
            />
          </div>
        </motion.section>
      ) : null}

      {/* Account grid */}
      {accounts.isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : accounts.isError ? (
        <ErrorState
          title={t('keyAccounts.errorTitle', "Couldn't load key accounts")}
          message={
            accountError ??
            t('keyAccounts.errorMessage', 'The key accounts endpoint did not respond.')
          }
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void accounts.refetch()}
            >
              {t('keyAccounts.retry', 'Retry')}
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('keyAccounts.emptyTitle', 'No key accounts yet')}
          message={t(
            'keyAccounts.emptyMessage',
            'Flag strategically important companies as Key Accounts from the Companies page.',
          )}
          action={
            <Link to="/companies" className="btn btn-primary">
              <Icon name="building" size={14} />
              {t('keyAccounts.emptyCta', 'Browse companies')}
            </Link>
          }
        />
      ) : (
        <>
          <motion.div layout className="grid grid-cols-1 gap-4">
            {items.map((account, index) => {
              const signal = keyAccountSignal(account);
              return (
                <motion.div
                  key={account.id}
                  layout
                  variants={reducedMotion ? undefined : staggerChild}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
                >
                  <Card>
                    <div className="flex items-start gap-4 p-5">
                      <CompanyLogo domain={account.domain} companyId={account.id} name={account.name} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            to={`/accounts/${encodeURIComponent(account.id)}`}
                            aria-label={t('keyAccounts.openCockpitAria', 'Open {{name}} customer cockpit', { name: account.name })}
                            className="text-base font-semibold text-[var(--fg-primary)] hover:text-[var(--brand-primary)] truncate"
                          >
                            {account.name}
                          </Link>
                          <KeyAccountBadge />
                          {account.industry ? <Badge tone="gray">{account.industry}</Badge> : null}
                        </div>
                        {account.domain ? (
                          <div className="text-xs text-[var(--fg-tertiary)]">{account.domain}</div>
                        ) : null}
                        {account.keyAccountNotes ? (
                          <div className="mt-1.5 text-sm text-[var(--fg-secondary)] line-clamp-2">
                            {account.keyAccountNotes}
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                          <span className="text-[var(--fg-secondary)]">
                            <span className="font-medium text-[var(--fg-primary)]">
                              {formatMoney(account.totalValue, 'EUR')}
                            </span>{' '}
                            {t('keyAccounts.metricPipeline', 'pipeline')}
                          </span>
                          <span className="text-[var(--fg-secondary)]">
                            <span className="font-medium text-[var(--fg-primary)]">
                              {account.openDeals}
                            </span>{' '}
                            {t('keyAccounts.metricOpenDeals', 'open deals')}
                          </span>
                          <span className="text-[var(--fg-secondary)]">
                            <span className="font-medium text-[var(--fg-primary)]">
                              {account.contactCount}
                            </span>{' '}
                            {t('keyAccounts.metricContacts', 'contacts')}
                          </span>
                        </div>
                        <StrategicSignalInsight
                          signal={signal}
                          label={`${account.name} strategic account signal`}
                          className="mt-3"
                        />
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
          {pager.hasPrevious || accounts.data?.nextCursor ? (
            <CursorPager
              currentPage={pager.page}
              hasNext={Boolean(accounts.data?.nextCursor)}
              hasPrevious={pager.hasPrevious}
              isLoading={accounts.isFetching}
              itemCount={items.length}
              label={t('keyAccounts.paginationLabel', 'key accounts')}
              onNext={() => pager.goNext(accounts.data?.nextCursor)}
              onPrevious={pager.goPrevious}
            />
          ) : null}
        </>
      )}
    </motion.div>
  );
}
