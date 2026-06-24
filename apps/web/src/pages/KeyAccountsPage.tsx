// Key Accounts — strategically important accounts flagged by admins.
// Shows full portfolio view with pipeline, contacts, and proactive alerts.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
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

import { StrategicSignalInsight } from './accountsPage/StrategicSignalInsight';
import { keyAccountSignal } from './accountsPage/strategicSignals';

const KEY_ACCOUNTS_PAGE_SIZE = 50;
const KEY_ACCOUNTS_SIGNAL_SIZE = 200;

export function KeyAccountsPage() {
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

  const items = useMemo(() => accounts.data?.items ?? [], [accounts.data?.items]);
  const signalItems = useMemo(
    () => signalAccounts.data?.items ?? items,
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
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          {t('keyAccounts.title', 'Strategic Accounts')}
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'keyAccounts.subtitle',
            'Regional strategic accounts owned for pipeline, coverage, and executive follow-through — distinct from the curated global Top 10.',
          )}
        </p>
      </motion.header>

      {/* Filters */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-[200px]">
          <label htmlFor="key-accounts-search" className="sr-only">
            {t('keyAccounts.searchLabel', 'Search key accounts')}
          </label>
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
            ariaHidden
          />
          <input
            id="key-accounts-search"
            type="search"
            placeholder={t('keyAccounts.searchPlaceholder', 'Search key accounts...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-9"
          />
        </div>
        <label htmlFor="key-accounts-industry" className="sr-only">
          {t('keyAccounts.industryFilterLabel', 'Filter key accounts by industry')}
        </label>
        <select
          id="key-accounts-industry"
          aria-label={t('keyAccounts.industryFilterLabel', 'Filter key accounts by industry')}
          aria-describedby={industries.isError ? 'key-accounts-industry-error' : undefined}
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="input"
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
        </select>
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
        {search || industry ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('');
              setIndustry('');
            }}
          >
            <Icon name="refresh" size={14} ariaHidden />
            {t('keyAccounts.resetFilters', 'Reset')}
          </Button>
        ) : null}
      </motion.div>

      {!accounts.isError && industryBreakdown.length > 0 ? (
        <motion.section
          variants={reducedMotion ? undefined : staggerChild}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]"
          aria-label={t('keyAccounts.industrySignalLabel', 'Key account industry signal')}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                {t('keyAccounts.industrySignalEyebrow', 'Industry signal')}
              </p>
              <h2 className="mt-1 truncate text-lg font-semibold text-[var(--fg-primary)]">
                {leadingIndustry
                  ? t('keyAccounts.industrySignalTitle', '{{industry}} leads the view', {
                      industry: leadingIndustry.name,
                    })
                  : t('keyAccounts.industrySignalFallback', 'No industry signal')}
              </h2>
              <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                {leadingIndustry
                  ? t('keyAccounts.industrySignalDetail', '{{count}} accounts / {{pipeline}} pipeline', {
                      count: leadingIndustry.count,
                      pipeline: formatMoney(leadingIndustry.pipeline, 'EUR'),
                    })
                  : t('keyAccounts.industrySignalEmpty', 'Add industries to companies to unlock the split.')}
              </p>
            </div>
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
          </div>
        </motion.section>
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

      {/* Stats strip */}
      {!accounts.isError ? (
        <motion.div
          variants={reducedMotion ? undefined : staggerChild}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <StatCard label={t('keyAccounts.statKeyAccounts', 'Key accounts')} value={items.length} />
          <StatCard
            label={t('keyAccounts.statTotalPipeline', 'Total pipeline')}
            value={formatMoney(
              totalPipeline,
              'EUR',
            )}
          />
          <StatCard label={t('keyAccounts.statOpenDeals', 'Open deals')} value={openDeals} />
          <StatCard label={t('keyAccounts.statContacts', 'Contacts')} value={contactCount} />
          <StatCard label={t('keyAccounts.statOpportunities', 'Opportunities')} value={opportunityCount} />
        </motion.div>
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
                            to={`/companies/${account.id}`}
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-[var(--fg-primary)]">{value}</div>
    </div>
  );
}
