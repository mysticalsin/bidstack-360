/**
 * dashboard/widgets/TopAccountsCard.tsx — top-5 slice of the real
 * /accounts/top endpoint for the OrgDashboard main column.
 *
 * WHY its own query: the card previously rendered the first 5 companies from
 * CRM dashboard data, which was not a ranking at all (demo-feedback M5). It
 * now self-fetches the curated global top-10 (or the auto pipeline-value
 * leaderboard fallback) and labels which source it is showing.
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { TopAccountBadge } from '@/components/company/AccountTierBadges';
import { useTopAccounts } from '@/hooks/useTopAccounts';
import { springSoft } from '@/lib/motion';
import { isSyntheticAccountName } from '@/pages/accountsPage/testDataFilter';

// ─── TopAccountsCard ─────────────────────────────────────────────────────────

export function TopAccountsCard() {
  const { t } = useTranslation('crm');
  const accounts = useTopAccounts({ limit: 5 });
  const items = (accounts.data?.items ?? [])
    .filter((a) => !isSyntheticAccountName(a.name))
    .slice(0, 5);
  const source = accounts.data?.source ?? 'auto';

  return (
    <GlassCard padding="md" hoverable={false}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
            <Icon name="trophy" size={13} className="text-[var(--tag-amber-fg)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{t('topAccounts.heading', 'Top accounts')}</h2>
          {!accounts.isLoading && !accounts.isError ? (
            <Badge tone={source === 'curated' ? 'amber' : 'gray'}>
              {source === 'curated'
                ? t('topAccounts.sourceCurated', 'Curated top 10')
                : t('topAccounts.sourceAuto', 'Auto-ranked')}
            </Badge>
          ) : null}
        </div>
        <Link to="/top-accounts" className="text-xs text-[var(--brand-primary)] hover:underline">
          {t('topAccounts.viewAll', 'View all')}
        </Link>
      </div>

      {accounts.isLoading ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--surface-sunken)]" />
          ))}
        </div>
      ) : accounts.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5">
          <span className="text-xs text-[var(--fg-secondary)]">{t('topAccounts.errorMessage', "Couldn't load top accounts.")}</span>
          <button
            type="button"
            className="min-h-[44px] rounded-md px-3 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--surface-hover)]"
            onClick={() => void accounts.refetch()}
          >
            {t('topAccounts.retry', 'Retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5 text-xs text-[var(--fg-secondary)]">
          {t(
            'topAccounts.empty',
            'No ranked accounts yet — add opportunity values or curate the Top 10 in Settings.',
          )}
        </p>
      ) : (
        <div className="space-y-1">
          {items.map((account, i) => (
            <motion.div
              key={account.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: i * 0.04 }}
            >
              <Link
                to={`/accounts/${account.id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-hover)] transition-colors group"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span className="w-5 shrink-0 text-center text-xs font-bold text-[var(--fg-tertiary)]">
                  {account.topAccountRank ?? i + 1}
                </span>
                <CompanyLogo name={account.name} companyId={account.id} domain={account.domain} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--fg-primary)]">
                      {account.name}
                    </span>
                    {source === 'curated' ? <TopAccountBadge /> : null}
                  </div>
                  <div className="truncate text-xs text-[var(--fg-tertiary)]">
                    {account.industry && account.industry !== 'Unknown industry'
                      ? account.industry
                      : account.domain
                        ? account.domain
                        : t('topAccounts.portfolioAccount', 'Portfolio account')}
                  </div>
                </div>
                <Icon
                  name="chevron-right"
                  size={14}
                  className="text-[var(--fg-tertiary)] group-hover:text-[var(--brand-primary)] transition-colors"
                />
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
