/**
 * Cross-sell action log - org-wide operating view (A2).
 * Pre-sales tracks cross-country / cross-team actions on shared accounts here;
 * the per-account slice also shows in each account cockpit (CrossSellCard).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useCrossSellActions, usePatchCrossSellAction } from '@/hooks/useCrossSell';
import type { CrossSellAction, GovernanceStatus } from '@bidstack/shared';

const STATUSES: { key: GovernanceStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

const STATUS_FILTER_I18N_KEY: Record<GovernanceStatus | 'all', string> = {
  all: 'crossSell.filterAll',
  open: 'crossSell.filterOpen',
  in_progress: 'crossSell.filterInProgress',
  done: 'crossSell.filterDone',
};

const STATUS_TONE: Record<GovernanceStatus, 'gray' | 'amber' | 'jade'> = {
  open: 'gray',
  in_progress: 'amber',
  done: 'jade',
};

const NEXT_STATUS: Record<GovernanceStatus, GovernanceStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'done',
};

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function isOverdue(action: CrossSellAction, today: string): boolean {
  const due = dateOnly(action.dueDate);
  return Boolean(due && due < today && action.status !== 'done');
}

function dueLabel(action: CrossSellAction, today: string): string {
  const due = dateOnly(action.dueDate);
  if (!due) return 'No due date';
  if (action.status === 'done') return `Closed ${due}`;
  if (due < today) return `Overdue ${due}`;
  if (due === today) return 'Due today';
  return `Due ${due}`;
}

function sortByDueDate(a: CrossSellAction, b: CrossSellAction): number {
  return (dateOnly(a.dueDate) ?? '9999-12-31').localeCompare(dateOnly(b.dueDate) ?? '9999-12-31');
}

export default function CrossSellPage() {
  const { t } = useTranslation('crm');
  const [status, setStatus] = useState<GovernanceStatus | 'all'>('all');
  const actions = useCrossSellActions(status === 'all' ? {} : { status });
  // KPI summary must reflect the whole org regardless of the table's status
  // filter — computing it from the filtered slice showed misleading zeros (e.g.
  // selecting "Done" made Active/Overdue/Unassigned all read 0). React Query
  // dedupes this with `actions` when status === 'all'.
  const allActions = useCrossSellActions({});
  const patch = usePatchCrossSellAction();
  const canWrite = useHasPermission('accounts:write');
  const today = new Date().toISOString().slice(0, 10);

  const items = useMemo(() => actions.data?.items ?? [], [actions.data?.items]);
  const summaryItems = useMemo(() => allActions.data?.items ?? [], [allActions.data?.items]);
  const summary = useMemo(() => {
    const active = summaryItems.filter((a) => a.status !== 'done');
    const overdue = active.filter((a) => isOverdue(a, today));
    const unassigned = active.filter((a) => !a.assigneeId);
    const nextDue = [...active].sort(sortByDueDate).find((a) => a.dueDate);
    return {
      activeCount: active.length,
      overdueCount: overdue.length,
      unassignedCount: unassigned.length,
      nextDue,
    };
  }, [summaryItems, today]);

  const statusLabel = (value: GovernanceStatus): string => {
    switch (value) {
      case 'open':
        return t('crossSell.status.open', 'Open');
      case 'in_progress':
        return t('crossSell.status.inProgress', 'In progress');
      case 'done':
        return t('crossSell.status.done', 'Done');
      default:
        return value;
    }
  };

  const advanceAction = (action: CrossSellAction) => {
    if (action.status === 'done') return;
    const next = NEXT_STATUS[action.status];
    patch.mutate(
      { id: action.id, body: { status: next } },
      {
        onSuccess: () =>
          toast.success(t('crossSell.statusAdvanced', 'Status advanced'), {
            description: statusLabel(next),
          }),
        onError: (err: Error) =>
          toast.error(t('crossSell.updateFailed', 'Update failed'), { description: err.message }),
      },
    );
  };

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('crossSell.title', 'Cross-sell actions')}</h1>
          <div className="page-sub">
            {t(
              'crossSell.subtitle',
              'Cross-country and cross-team sales actions on shared accounts. Owned by pre-sales.',
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-tertiary)]">{t('crossSell.kpiActive', 'Active')}</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--fg-primary)]" data-testid="cross-sell-active-count">
            {summary.activeCount}
          </p>
          <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
            {t('crossSell.kpiActiveHint', 'Open or in progress')}
          </p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-tertiary)]">{t('crossSell.kpiOverdue', 'Overdue')}</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--fg-primary)]" data-testid="cross-sell-overdue-count">
            {summary.overdueCount}
          </p>
          <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
            {t('crossSell.kpiOverdueHint', 'Needs owner attention')}
          </p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-tertiary)]">{t('crossSell.kpiUnassigned', 'Unassigned')}</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--fg-primary)]" data-testid="cross-sell-unassigned-count">
            {summary.unassignedCount}
          </p>
          <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
            {t('crossSell.kpiUnassignedHint', 'No assignee yet')}
          </p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-tertiary)]">{t('crossSell.kpiNextDue', 'Next due')}</p>
          <p className="mt-1 truncate text-sm font-semibold text-[var(--fg-primary)]" data-testid="cross-sell-next-due">
            {summary.nextDue ? dateOnly(summary.nextDue.dueDate) : t('crossSell.noDatedAction', 'No dated action')}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--fg-tertiary)]">
            {summary.nextDue?.description ?? t('crossSell.allClear', 'No dated active action')}
          </p>
        </Card>
      </div>

      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('crossSell.filterGroupLabel', 'Filter by status')}
      >
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
            {t(STATUS_FILTER_I18N_KEY[s.key], s.label)}
          </button>
        ))}
      </div>

      {actions.isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : actions.isError ? (
        <ErrorState
          title={t('crossSell.errorTitle', 'Could not load cross-sell actions')}
          message={actions.error?.message ?? t('crossSell.errorMessage', 'Try again shortly.')}
        />
      ) : items.length === 0 ? (
        status !== 'all' ? (
          <EmptyState
            title={t('crossSell.emptyFilteredTitle', 'No {{status}} cross-sell actions', {
              status: statusLabel(status).toLowerCase(),
            })}
            message={t(
              'crossSell.emptyFilteredMessage',
              'No actions match this filter. Clear it to see every cross-sell action.',
            )}
            action={
              <Button variant="secondary" size="sm" onClick={() => setStatus('all')}>
                {t('crossSell.showAll', 'Show all')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('crossSell.emptyTitle', 'No cross-sell actions')}
            message={t(
              'crossSell.emptyMessage',
              "Log cross-team actions from any account's cockpit. They appear here for the whole org.",
            )}
          />
        )
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
                  <th className="px-4 py-2 font-medium">{t('crossSell.colAccount', 'Account')}</th>
                  <th className="px-4 py-2 font-medium">{t('crossSell.colAction', 'Action')}</th>
                  <th className="px-4 py-2 font-medium">{t('crossSell.colRoute', 'Route')}</th>
                  <th className="px-4 py-2 font-medium">{t('crossSell.colOwner', 'Owner')}</th>
                  <th className="px-4 py-2 font-medium">{t('crossSell.colDue', 'Due')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('crossSell.colStatus', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((action) => {
                  const done = action.status === 'done';
                  const overdue = isOverdue(action, today);
                  const busy = patch.isPending && patch.variables?.id === action.id;
                  return (
                    <tr key={action.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-4 py-3 align-top">
                        <Link
                          to={`/accounts/${encodeURIComponent(action.accountKey)}`}
                          className="font-medium text-[var(--brand-primary)] hover:underline"
                        >
                          {action.accountKey}
                        </Link>
                      </td>
                      <td className="px-4 py-3 align-top text-[var(--fg-secondary)]">
                        <span className="line-clamp-2" title={action.description}>
                          {action.description}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="text-xs text-[var(--fg-tertiary)]">
                          {action.requestingUnit} -&gt; {action.assignedUnit}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-[var(--fg-tertiary)]">
                        {action.assigneeName ?? t('crossSell.unassigned', 'Unassigned')}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Badge tone={overdue ? 'tomato' : done ? 'jade' : 'gray'}>{dueLabel(action, today)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        <button
                          type="button"
                          disabled={!canWrite || done || patch.isPending}
                          aria-busy={busy}
                          onClick={() => advanceAction(action)}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:opacity-60"
                          aria-label={t('crossSell.advanceStatusAria', 'Advance status of {{description}}', {
                            description: action.description,
                          })}
                          title={
                            done
                              ? t('crossSell.doneStatusHint', 'Completed actions stay closed')
                              : canWrite
                                ? t('crossSell.advanceStatusHint', 'Advance to next status')
                                : undefined
                          }
                          data-testid={`cross-sell-${action.id}-status`}
                        >
                          <Badge tone={STATUS_TONE[action.status]}>
                            {busy ? t('crossSell.updating', 'updating...') : statusLabel(action.status)}
                          </Badge>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
