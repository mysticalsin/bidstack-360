// Admin-only RFP analytics — the org-wide "see everything + values" surface.
//
// Regular users are owner-scoped on the API (see canViewAllRfps); this page is
// the admin rollup of EVERY RFP across all owners: counts, pipeline value (from
// each proposal's linked opportunity), win rate, and a per-owner breakdown.
// Gated by RequireAdmin in the route tree.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/StateMessages';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
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

export function AdminRfpPage() {
  useDocumentTitle();
  const q = useQuery<RfpAnalytics>({
    queryKey: ['admin-rfp', 'analytics'],
    queryFn: ({ signal }) => api<RfpAnalytics>('/api/v1/proposals/admin/analytics', { signal }),
  });

  const closed = (q.data?.wonCount ?? 0) + (q.data?.lostCount ?? 0);
  const winRate = closed > 0 ? Math.round(((q.data?.wonCount ?? 0) / closed) * 100) : null;
  const inFlight = (q.data?.totalCount ?? 0) - closed;

  return (
    <div className="space-y-6">
      <header className="page-head">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            Admin
          </p>
          <h1 className="page-title">RFP Analytics</h1>
          <p className="page-sub">
            Every RFP across the organisation, its value, and the per-owner breakdown.
          </p>
        </div>
        <Link
          to="/proposals"
          className="inline-flex h-11 items-center text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          View all proposals
        </Link>
      </header>

      {q.isError ? (
        <Card className="p-6">
          <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            Failed to load RFP analytics. Please retry.
          </div>
        </Card>
      ) : (
        <>
          {/* KPI strip */}
          <section
            aria-label="RFP analytics key metrics"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <KpiTile
              label="Total RFPs"
              value={q.isLoading ? '…' : String(q.data?.totalCount ?? 0)}
              detail="across all owners"
              icon="briefcase"
            />
            <KpiTile
              label="Pipeline value"
              value={q.isLoading ? '…' : formatEur(q.data?.totalValueMicros ?? '0')}
              detail="linked opportunity value"
              icon="dollar"
            />
            <KpiTile
              label="Win rate"
              value={winRate === null ? '—' : `${winRate}%`}
              detail={`${q.data?.wonCount ?? 0} won · ${closed} closed`}
              icon="trophy"
            />
            <KpiTile
              label="In flight"
              value={q.isLoading ? '…' : String(Math.max(0, inFlight))}
              detail="not yet won or lost"
              icon="pipeline"
            />
          </section>

          {/* By status */}
          <Card>
            <div className="border-b border-[var(--border-subtle)] px-4 py-2">
              <h2 className="text-sm font-semibold text-[var(--fg-primary)]">By status</h2>
            </div>
            {q.isLoading ? (
              <div className="p-6 text-sm text-[var(--fg-secondary)]">Loading…</div>
            ) : !q.data?.byStatus.length ? (
              <div className="p-6">
                <EmptyState
                  title="No RFPs yet"
                  message="Proposals will appear here as your team creates them."
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
                    <span className="rounded-full bg-black/10 px-1.5 dark:bg-white/15">
                      {s.count}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </Card>

          {/* By owner */}
          <Card>
            <div className="border-b border-[var(--border-subtle)] px-4 py-2">
              <h2 className="text-sm font-semibold text-[var(--fg-primary)]">By owner</h2>
              <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                Who owns what, and the pipeline value behind it.
              </p>
            </div>
            {q.isLoading ? (
              <div className="p-6 text-sm text-[var(--fg-secondary)]">Loading…</div>
            ) : !q.data?.byOwner.length ? (
              <div className="p-6">
                <EmptyState
                  title="No owners yet"
                  message="Assign proposals to see the per-owner breakdown."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
                      <th className="px-4 py-2 font-semibold">Owner</th>
                      <th className="px-4 py-2 text-right font-semibold">RFPs</th>
                      <th className="px-4 py-2 text-right font-semibold">Pipeline value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {q.data.byOwner.map((o) => (
                      <tr
                        key={o.ownerId ?? 'unassigned'}
                        className="hover:bg-[var(--surface-sunken)]"
                      >
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
        </>
      )}
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
