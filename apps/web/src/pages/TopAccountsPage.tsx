// Top Accounts — the curated global top-10 when admins have ranked accounts
// in Settings; otherwise an auto leaderboard by total revenue/pipeline.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { KeyAccountBadge, TopAccountBadge } from '@/components/company/AccountTierBadges';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useTopAccounts } from '@/hooks/useTopAccounts';
import { useAccountIndustries } from '@/hooks/useKeyAccounts';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft, staggerChild, staggerParent } from '@/lib/motion';

import { StrategicSignalInsight } from './accountsPage/StrategicSignalInsight';
import { topAccountSignal } from './accountsPage/strategicSignals';
import { isSyntheticAccountName } from './accountsPage/testDataFilter';

export function TopAccountsPage() {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<string>('');
  const { formatMoney } = useFormatMoney();

  const industries = useAccountIndustries();
  const accounts = useTopAccounts({
    search: search || undefined,
    industry: industry || undefined,
    limit: 20,
  });

  const items = useMemo(
    () => (accounts.data?.items ?? []).filter((a) => !isSyntheticAccountName(a.name)),
    [accounts.data?.items],
  );
  const source = accounts.data?.source ?? 'auto';
  const accountError = accounts.error instanceof Error ? accounts.error.message : undefined;
  const industryError = industries.error instanceof Error ? industries.error.message : undefined;
  const totalPipeline = useMemo(
    () => items.reduce((sum, account) => sum + account.totalValue, 0),
    [items],
  );
  const wonPipeline = useMemo(() => items.reduce((sum, account) => sum + account.wonValue, 0), [items]);
  const openDeals = useMemo(() => items.reduce((sum, account) => sum + account.openDeals, 0), [items]);
  const contactCount = useMemo(
    () => items.reduce((sum, account) => sum + account.contactCount, 0),
    [items],
  );
  const industryBreakdown = useMemo(() => {
    const unclassifiedIndustry = t('topAccounts.unclassifiedIndustry', 'Unclassified');
    const byIndustry = new Map<string, { count: number; pipeline: number; filterValue: string | null }>();
    for (const account of items) {
      const key = account.industry || unclassifiedIndustry;
      const current = byIndustry.get(key) ?? {
        count: 0,
        pipeline: 0,
        filterValue: account.industry,
      };
      current.count += 1;
      current.pipeline += account.totalValue;
      byIndustry.set(key, current);
    }
    return [...byIndustry.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.pipeline - a.pipeline || b.count - a.count)
      .slice(0, 5);
  }, [items, t]);
  const maxIndustryPipeline = Math.max(1, ...industryBreakdown.map((item) => item.pipeline));
  const leader = items[0] ?? null;

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header variants={reducedMotion ? undefined : staggerChild}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            {t('topAccounts.heading', 'Account Ranking')}
          </h1>
          {!accounts.isLoading && !accounts.isError ? (
            source === 'curated' ? (
              <Badge tone="amber">
                <Icon name="trophy" size={11} ariaHidden />
                {t('topAccounts.badgeCurated', 'Curated — Amaris global top 10')}
              </Badge>
            ) : (
              <Badge tone="gray">{t('topAccounts.badgeAuto', 'Auto-ranked by pipeline value')}</Badge>
            )
          ) : null}
        </div>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {source === 'curated'
            ? t('topAccounts.subtitleCurated', 'The global top 10, hand-picked and ordered by admins in Settings.')
            : t('topAccounts.subtitleAuto', 'Highest-value accounts ranked by total pipeline and revenue.')}
        </p>
      </motion.header>

      {/* Filters */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-[200px]">
          <label htmlFor="top-accounts-search" className="sr-only">
            {t('topAccounts.searchLabel', 'Search top accounts')}
          </label>
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
            ariaHidden
          />
          <input
            id="top-accounts-search"
            type="search"
            placeholder={t('topAccounts.searchPlaceholder', 'Search top accounts...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-9"
          />
        </div>
        <label htmlFor="top-accounts-industry" className="sr-only">
          {t('topAccounts.industryLabel', 'Filter top accounts by industry')}
        </label>
        <select
          id="top-accounts-industry"
          aria-label={t('topAccounts.industryLabel', 'Filter top accounts by industry')}
          aria-describedby={industries.isError ? 'top-accounts-industry-error' : undefined}
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="input"
        >
          <option value="">
            {industries.isError
              ? t('topAccounts.industriesUnavailable', 'Industries unavailable')
              : t('topAccounts.allIndustries', 'All industries')}
          </option>
          {(industries.data?.items ?? []).map((i: string) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        {industries.isError ? (
          <div
            id="top-accounts-industry-error"
            role="alert"
            className="flex items-center gap-2 text-xs text-[var(--danger)]"
          >
            <span>{industryError ?? t('topAccounts.industryLoadError', 'Could not load industry filters.')}</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 font-semibold text-[var(--danger)] hover:bg-[var(--danger-tint)]"
              onClick={() => void industries.refetch()}
            >
              {t('topAccounts.retry', 'Retry')}
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
            {t('topAccounts.resetFilters', 'Reset')}
          </Button>
        ) : null}
      </motion.div>

      {!accounts.isError && items.length > 0 ? (
        <motion.section
          variants={reducedMotion ? undefined : staggerChild}
          className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]"
          aria-label={t('topAccounts.commandPanelLabel', 'Account ranking command panel')}
        >
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {t('topAccounts.leaderEyebrow', 'Leaderboard signal')}
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold text-[var(--fg-primary)]">
                  {leader
                    ? t('topAccounts.leaderTitle', '{{name}} is leading', { name: leader.name })
                    : t('topAccounts.leaderFallback', 'No leader yet')}
                </h2>
                <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                  {leader
                    ? t('topAccounts.leaderDetail', '{{pipeline}} pipeline / {{deals}} open deals', {
                        pipeline: formatMoney(leader.totalValue, 'EUR'),
                        deals: leader.openDeals,
                      })
                    : t('topAccounts.leaderEmpty', 'Add opportunity value to create a ranking.')}
                </p>
              </div>
              <Badge tone={source === 'curated' ? 'amber' : 'blue'}>
                <Icon name={source === 'curated' ? 'trophy' : 'growth'} size={12} ariaHidden />
                {source === 'curated'
                  ? t('topAccounts.sourceCuratedShort', 'Curated')
                  : t('topAccounts.sourceAutoShort', 'Auto')}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label={t('topAccounts.statPipeline', 'Pipeline')} value={formatMoney(totalPipeline, 'EUR')} />
              <StatCard label={t('topAccounts.statWon', 'Won')} value={formatMoney(wonPipeline, 'EUR')} />
              <StatCard label={t('topAccounts.statOpenDeals', 'Open deals')} value={openDeals} />
              <StatCard label={t('topAccounts.statContacts', 'Contacts')} value={contactCount} />
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {t('topAccounts.industryMixEyebrow', 'Industry mix')}
                </p>
                <h2 className="mt-1 text-sm font-semibold text-[var(--fg-primary)]">
                  {t('topAccounts.industryMixTitle', 'Pipeline by industry')}
                </h2>
              </div>
              {industry ? <Badge tone="blue">{industry}</Badge> : null}
            </div>
            <div className="space-y-2">
              {industryBreakdown.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  aria-label={
                    item.filterValue
                      ? t('topAccounts.filterByIndustry', 'Filter top accounts by {{industry}}', {
                          industry: item.name,
                        })
                      : t('topAccounts.clearIndustryFilter', 'Clear top account industry filter')
                  }
                  aria-pressed={item.filterValue !== null && industry === item.filterValue}
                  onClick={() =>
                    item.filterValue
                      ? setIndustry(industry === item.filterValue ? '' : item.filterValue)
                      : setIndustry('')
                  }
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 text-left transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                >
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-semibold text-[var(--fg-primary)]">{item.name}</span>
                    <span className="font-medium text-[var(--fg-tertiary)]">{formatMoney(item.pipeline, 'EUR')}</span>
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
          ? `${t('topAccounts.resultCount', '{{count}} account', { count: items.length })}${industry ? ` · ${industry}` : ''}`
          : ''}
      </p>

      {/* Leaderboard */}
      {accounts.isLoading ? (
        <LoadingSkeleton rows={5} />
      ) : accounts.isError ? (
        <ErrorState
          title={t('topAccounts.errorTitle', "Couldn't load top accounts")}
          message={accountError ?? t('topAccounts.errorMessage', 'The top accounts endpoint did not respond.')}
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void accounts.refetch()}
            >
              {t('topAccounts.retry', 'Retry')}
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('topAccounts.emptyTitle', 'No account data yet')}
          message={t('topAccounts.emptyMessage', 'Add opportunities with values to see top accounts ranked by pipeline.')}
          action={
            <Link to="/companies" className="btn btn-primary">
              <Icon name="building" size={14} />
              {t('topAccounts.emptyCta', 'Browse companies')}
            </Link>
          }
        />
      ) : (
        <motion.div layout className="space-y-3">
          {items.map((account, index) => (
            <motion.div
              key={account.id}
              layout
              variants={reducedMotion ? undefined : staggerChild}
              initial={reducedMotion ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.03 }}
            >
              <Card>
                <div className="flex items-center gap-4 p-4">
                  {/* Rank */}
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      index === 0
                        ? 'bg-amber-100 text-amber-700'
                        : index === 1
                          ? 'bg-slate-100 text-slate-600'
                          : index === 2
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]'
                    }`}
                  >
                    {index + 1}
                  </div>

                  <CompanyLogo domain={account.domain} companyId={account.id} name={account.name} size={40} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/companies/${account.id}`}
                        className="font-semibold text-[var(--fg-primary)] hover:text-[var(--brand-primary)] truncate"
                      >
                        {account.name}
                      </Link>
                      {source === 'curated' && (
                        <TopAccountBadge rank={account.topAccountRank ?? index + 1} />
                      )}
                      {account.tier === 'key' && <KeyAccountBadge />}
                      {account.industry && <Badge tone="gray">{account.industry}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--fg-secondary)]">
                      <span>
                        <span className="font-medium text-[var(--fg-primary)]">
                          {formatMoney(account.totalValue, 'EUR')}
                        </span>{' '}
                        {t('topAccounts.totalPipeline', 'total pipeline')}
                      </span>
                      <span>·</span>
                      <span>
                        <span className="font-medium text-[var(--fg-primary)]">
                          {formatMoney(account.wonValue, 'EUR')}
                        </span>{' '}
                        {t('topAccounts.won', 'won')}
                      </span>
                      <span>·</span>
                      <span>{t('topAccounts.openDeals', '{{count}} open deals', { count: account.openDeals })}</span>
                      <span>·</span>
                      <span>{t('topAccounts.contacts', '{{count}} contacts', { count: account.contactCount })}</span>
                    </div>
                    <StrategicSignalInsight
                      signal={topAccountSignal(account, source)}
                      label={`${account.name} ranking signal`}
                      compact
                      className="mt-3"
                    />
                  </div>

                  {/* Pipeline bar */}
                  <div className="hidden sm:block w-32">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <div
                        className="h-full rounded-full bg-[var(--brand-primary)]"
                        style={{
                          width: `${items[0]?.totalValue ? Math.min(100, (account.totalValue / items[0].totalValue) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--fg-primary)]">{value}</div>
    </div>
  );
}
