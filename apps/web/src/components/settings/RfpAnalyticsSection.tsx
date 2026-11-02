// Org-wide RFP analytics — the admin rollup of EVERY RFP across all owners:
// counts, pipeline value (from each proposal's linked opportunity), win rate, and
// a per-owner breakdown. Rendered as the admin-gated "RFP Analytics" tab in
// Settings and on the standalone /admin/rfp page; both hosts supply their own
// heading, so this section is heading-less.
//
// Regular users are owner-scoped on the API (see canViewAllRfps); this surface is
// admin-only — the Settings tab is admin-gated and /admin/rfp is RequireAdmin.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';
import {
  proposalStatusLabel,
  proposalStatusTone,
} from '@/components/rfp/shared/ProposalStatusChip';

interface OwnerRow {
  ownerId: string | null;
  ownerName: string;
  count: number;
  totalValueMicros: string;
}
interface RfpAnalytics {
  totalCount: number;
  wonCount: number;
  lostCount: number;
  totalValueMicros: string;
  byStatus: Array<{ status: string; count: number }>;
  byOwner: OwnerRow[];
}

// Money is stored + transported in micros (CLAUDE.md convention). Format to a
// whole-euro currency string at the edge for display.
function formatEur(micros: string): string {
  const eur = Number(micros) / 1e6;
  if (!Number.isFinite(eur)) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(eur);
}

export function RfpAnalyticsSection() {
  const { t } = useTranslation('settings');
  const q = useQuery<RfpAnalytics>({
    queryKey: ['admin-rfp', 'analytics'],
    queryFn: ({ signal }) => api<RfpAnalytics>('/api/v1/proposals/admin/analytics', { signal }),
  });

  const closed = (q.data?.wonCount ?? 0) + (q.data?.lostCount ?? 0);
  const winRate = closed > 0 ? Math.round(((q.data?.wonCount ?? 0) / closed) * 100) : null;
  const inFlight = (q.data?.totalCount ?? 0) - closed;

  if (q.isError) {
    return (
      <Card className="p-6">
        <div role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('rfpAnalytics.errorMessage', 'Failed to load RFP analytics. Please retry.')}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <section
        aria-label={t('rfpAnalytics.kpiSectionLabel', 'RFP analytics key metrics')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <KpiTile
          label={t('rfpAnalytics.kpiTotalLabel', 'Total RFPs')}
          value={q.isLoading ? '…' : String(q.data?.totalCount ?? 0)}
          detail={t('rfpAnalytics.kpiTotalDetail', 'across all owners')}
          icon="briefcase"
        />
        <KpiTile
          label={t('rfpAnalytics.kpiPipelineLabel', 'Pipeline value')}
          value={q.isLoading ? '…' : formatEur(q.data?.totalValueMicros ?? '0')}
          detail={t('rfpAnalytics.kpiPipelineDetail', 'linked opportunity value')}
          icon="dollar"
        />
        <KpiTile
          label={t('rfpAnalytics.kpiWinRateLabel', 'Win rate')}
          value={winRate === null ? '—' : `${winRate}%`}
          detail={t('rfpAnalytics.kpiWinRateDetail', '{{won}} won · {{closed}} closed', {
            won: q.data?.wonCount ?? 0,
            closed,
          })}
          icon="trophy"
        />
        <KpiTile
          label={t('rfpAnalytics.kpiInFlightLabel', 'In flight')}
          value={q.isLoading ? '…' : String(Math.max(0, inFlight))}
          detail={t('rfpAnalytics.kpiInFlightDetail', 'not yet won or lost')}
          icon="pipeline"
        />
      </section>

      {/* By status */}
      <Card>
        <div className="border-b border-[var(--border-subtle)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('rfpAnalytics.byStatusTitle', 'By status')}
          </h3>
        </div>
        {q.isLoading ? (
          // Shimmer pills shaped like the status chips — shared bs-shimmer
          // system, not a bare "Loading…" string.
          <div
            className="flex flex-wrap gap-2 p-4"
            aria-busy="true"
            aria-live="polite"
            aria-label={t('rfpAnalytics.loading', 'Loading…')}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="bs-shimmer h-6 w-24 rounded-full" aria-hidden />
            ))}
          </div>
        ) : !q.data?.byStatus.length ? (
          <div className="p-6">
            <EmptyState
              title={t('rfpAnalytics.byStatusEmptyTitle', 'No RFPs yet')}
              message={t(
                'rfpAnalytics.byStatusEmptyMessage',
                'Proposals will appear here as your team creates them.',
              )}
            />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 p-4">
            {q.data.byStatus.map((s) => (
              <span
                key={s.status}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${proposalStatusTone(s.status)}`}
              >
                {proposalStatusLabel(s.status)}
                <span className="rounded-full bg-black/10 px-1.5 dark:bg-white/15">{s.count}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* By owner */}
      <Card>
        <div className="border-b border-[var(--border-subtle)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('rfpAnalytics.byOwnerTitle', 'By owner')}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
            {t('rfpAnalytics.byOwnerSubtitle', 'Who owns what, and the pipeline value behind it.')}
          </p>
        </div>
        {q.isLoading ? (
          // Shimmer rows shaped like the per-owner table — shared bs-shimmer
          // system, not a bare "Loading…" string.
          <div
            className="space-y-3 p-4"
            aria-busy="true"
            aria-live="polite"
            aria-label={t('rfpAnalytics.loading', 'Loading…')}
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4" aria-hidden>
                <span className="bs-shimmer h-4 w-40" />
                <span className="bs-shimmer h-4 w-16" />
                <span className="bs-shimmer ml-auto h-4 w-24" />
              </div>
            ))}
          </div>
        ) : !q.data?.byOwner.length ? (
          <div className="p-6">
            <EmptyState
              title={t('rfpAnalytics.byOwnerEmptyTitle', 'No owners yet')}
              message={t(
                'rfpAnalytics.byOwnerEmptyMessage',
                'Assign proposals to see the per-owner breakdown.',
              )}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
                  <th className="px-4 py-2 font-semibold">
                    {t('rfpAnalytics.tableOwner', 'Owner')}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t('rfpAnalytics.tableRfps', 'RFPs')}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t('rfpAnalytics.tablePipelineValue', 'Pipeline value')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {q.data.byOwner.map((o) => (
                  <tr key={o.ownerId ?? 'unassigned'} className="hover:bg-[var(--surface-sunken)]">
                    <td className="px-4 py-2.5 font-medium text-[var(--fg-primary)]">
                      {o.ownerName}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">
                      {o.count}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">
                      {formatEur(o.totalValueMicros)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: IconName;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label}
        </span>
        <Icon name={icon} size={14} ariaHidden />
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{detail}</div>
    </Card>
  );
}
