/**
 * Cross-sell action log — org-wide view (A2). Pre-sales tracks cross-country /
 * cross-team actions on shared accounts here; the per-account slice also shows
 * on each account cockpit (CrossSellCard).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { useCrossSellActions, usePatchCrossSellAction } from '@/hooks/useCrossSell';
import type { GovernanceStatus } from '@bidstack/shared';

const STATUSES: { key: GovernanceStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];
const STATUS_TONE: Record<GovernanceStatus, 'gray' | 'amber' | 'jade'> = {
  open: 'gray',
  in_progress: 'amber',
  done: 'jade',
};
const NEXT_STATUS: Record<GovernanceStatus, GovernanceStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
};

export default function CrossSellPage() {
  const [status, setStatus] = useState<GovernanceStatus | 'all'>('all');
  const actions = useCrossSellActions(status === 'all' ? {} : { status });
  const patch = usePatchCrossSellAction();
  const canWrite = useIsAdmin();

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">Cross-sell actions</h1>
          <div className="page-sub">
            Cross-country and cross-team sales actions on shared accounts. Owned by pre-sales.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStatus(s.key)}
            aria-pressed={status === s.key}
            className={`min-h-[44px] rounded-full border px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] ${
              status === s.key
                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                : 'border-[var(--border)] text-[var(--fg-secondary)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {actions.isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : actions.isError ? (
        <ErrorState
          title="Could not load cross-sell actions"
          message={actions.error?.message ?? 'Try again shortly.'}
        />
      ) : (actions.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No cross-sell actions"
          message="Log cross-team actions from any account's cockpit — they appear here for the whole org."
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Route</th>
                <th className="px-4 py-2 font-medium">Assignee</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {actions.data!.items.map((a) => (
                <tr key={a.id} className="border-b border-[var(--border)]">
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/accounts/${encodeURIComponent(a.accountKey)}`}
                      className="text-[var(--brand-primary)] hover:underline"
                    >
                      {a.accountKey}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--fg-secondary)]">
                    <span className="line-clamp-2" title={a.description}>
                      {a.description}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--fg-tertiary)]">
                    {a.requestingUnit} → {a.assignedUnit}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--fg-tertiary)]">
                    {a.assigneeName ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--fg-tertiary)]">
                    {a.dueDate ? a.dueDate.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={!canWrite || patch.isPending}
                      aria-busy={patch.isPending && patch.variables?.id === a.id}
                      onClick={() =>
                        patch.mutate(
                          { id: a.id, body: { status: NEXT_STATUS[a.status] } },
                          { onError: (err: Error) => toast.error('Update failed', { description: err.message }) },
                        )
                      }
                      className="min-h-[28px] rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:opacity-60"
                      aria-label={`Advance status of ${a.description}`}
                    >
                      {/* Per-row pending label so a slow PATCH shows WHICH row is
                          updating instead of the whole table looking frozen. */}
                      <Badge tone={STATUS_TONE[a.status]}>
                        {patch.isPending && patch.variables?.id === a.id
                          ? 'updating…'
                          : a.status.replace('_', ' ')}
                      </Badge>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
