// Top Accounts — highest-value accounts ranked by total revenue/pipeline.
// Auto-computed rankings, expandable into full account intelligence.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useTopAccounts } from '@/hooks/useTopAccounts';
import { useAccountIndustries } from '@/hooks/useKeyAccounts';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft, staggerChild, staggerParent } from '@/lib/motion';

export function TopAccountsPage() {
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

  const items = accounts.data?.items ?? [];
  const accountError = accounts.error instanceof Error ? accounts.error.message : undefined;
  const industryError = industries.error instanceof Error ? industries.error.message : undefined;

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header variants={reducedMotion ? undefined : staggerChild}>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          Account Ranking
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Highest-value accounts ranked by total pipeline and revenue.
        </p>
      </motion.header>

      {/* Filters */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-[200px]">
          <label htmlFor="top-accounts-search" className="sr-only">
            Search top accounts
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
            placeholder="Search top accounts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-9"
          />
        </div>
        <label htmlFor="top-accounts-industry" className="sr-only">
          Filter top accounts by industry
        </label>
        <select
          id="top-accounts-industry"
          aria-label="Filter top accounts by industry"
          aria-describedby={industries.isError ? 'top-accounts-industry-error' : undefined}
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="input"
        >
          <option value="">
            {industries.isError ? 'Industries unavailable' : 'All industries'}
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
            <span>{industryError ?? 'Could not load industry filters.'}</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 font-semibold text-[var(--danger)] hover:bg-[var(--danger-tint)]"
              onClick={() => void industries.refetch()}
            >
              Retry
            </button>
          </div>
        ) : null}
      </motion.div>

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!accounts.isLoading && accounts.data
          ? `${items.length} account${items.length === 1 ? '' : 's'}${industry ? ` · ${industry}` : ''}`
          : ''}
      </p>

      {/* Leaderboard */}
      {accounts.isLoading ? (
        <LoadingSkeleton rows={5} />
      ) : accounts.isError ? (
        <ErrorState
          title="Couldn't load top accounts"
          message={accountError ?? 'The top accounts endpoint did not respond.'}
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void accounts.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No account data yet"
          message="Add opportunities with values to see top accounts ranked by pipeline."
        />
      ) : (
        <div className="space-y-3">
          {items.map((account, index) => (
            <motion.div
              key={account.id}
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

                  <CompanyLogo domain={account.domain} name={account.name} size={40} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/companies/${account.id}`}
                        className="font-semibold text-[var(--fg-primary)] hover:text-[var(--brand-primary)] truncate"
                      >
                        {account.name}
                      </Link>
                      {account.tier === 'key' && <Badge tone="purple">Key</Badge>}
                      {account.industry && <Badge tone="gray">{account.industry}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--fg-secondary)]">
                      <span>
                        <span className="font-medium text-[var(--fg-primary)]">
                          {formatMoney(account.totalValue, 'EUR')}
                        </span>{' '}
                        total pipeline
                      </span>
                      <span>·</span>
                      <span>
                        <span className="font-medium text-[var(--fg-primary)]">
                          {formatMoney(account.wonValue, 'EUR')}
                        </span>{' '}
                        won
                      </span>
                      <span>·</span>
                      <span>{account.openDeals} open deals</span>
                      <span>·</span>
                      <span>{account.contactCount} contacts</span>
                    </div>
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
        </div>
      )}
    </motion.div>
  );
}
