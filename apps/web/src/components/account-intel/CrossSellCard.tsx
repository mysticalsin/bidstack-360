/**
 * Cross-sell action log for the open account (A2). Structured, assignable
 * actions across countries/teams on a shared account — pre-sales owns it.
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { useUsers } from '@/hooks/useUsers';
import {
  useCreateCrossSellAction,
  useCrossSellActions,
  usePatchCrossSellAction,
} from '@/hooks/useCrossSell';
import type { CrossSellAction, GovernanceStatus } from '@bidstack/shared';

const STATUS_TONE: Record<GovernanceStatus, 'gray' | 'amber' | 'jade'> = {
  open: 'gray',
  in_progress: 'amber',
  done: 'jade',
};
const STATUS_LABEL: Record<GovernanceStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
};
const NEXT_STATUS: Record<GovernanceStatus, GovernanceStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
};

export function CrossSellCard({ accountKey }: { accountKey: string }) {
  const actions = useCrossSellActions({ accountKey });
  const patch = usePatchCrossSellAction();
  const canWrite = useIsAdmin();
  const { t } = useTranslation('crm');

  const statusLabel = (status: GovernanceStatus): string => {
    switch (status) {
      case 'open':
        return t('crossSell.status.open', 'Open');
      case 'in_progress':
        return t('crossSell.status.inProgress', 'In progress');
      case 'done':
        return t('crossSell.status.done', 'Done');
      default:
        return STATUS_LABEL[status];
    }
  };

  return (
    <Card role="region" aria-label={t('crossSell.regionLabel', 'Cross-sell actions')}>
      <SectionHeader
        title={t('crossSell.title', 'Cross-sell actions')}
        caption={t('crossSell.caption', 'Cross-country / cross-team sales actions on this account')}
        action={canWrite ? <CreateAction accountKey={accountKey} /> : undefined}
      />
      <div className="px-5 pb-5">
        {actions.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : actions.isError ? (
          <ErrorState
            title={t('crossSell.errorTitle', 'Could not load cross-sell actions')}
            message={actions.error?.message ?? t('crossSell.errorRetry', 'Try again shortly.')}
          />
        ) : (actions.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--fg-tertiary)]">
            {t('crossSell.empty', 'No cross-sell actions logged for this account yet.')}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {actions.data!.items.map((action) => (
              <li key={action.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--fg-primary)]">{action.description}</p>
                    <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                      {action.requestingUnit} → {action.assignedUnit}
                      {action.assigneeName ? ` · ${action.assigneeName}` : ''}
                      {action.dueDate ? ` · due ${action.dueDate.slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!canWrite || patch.isPending}
                    onClick={() =>
                      patch.mutate({ id: action.id, body: { status: NEXT_STATUS[action.status] } })
                    }
                    className="min-h-[28px] shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:opacity-60"
                    aria-label={t('crossSell.advanceStatusLabel', 'Advance status of {{description}}', {
                      description: action.description,
                    })}
                    title={canWrite ? t('crossSell.advanceStatusHint', 'Click to advance status') : undefined}
                  >
                    <Badge tone={STATUS_TONE[action.status]}>{statusLabel(action.status)}</Badge>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CreateAction({ accountKey }: { accountKey: string }) {
  const [open, setOpen] = useState(false);
  const users = useUsers();
  const create = useCreateCrossSellAction();
  const { t } = useTranslation('crm');
  const [form, setForm] = useState({
    description: '',
    requestingUnit: '',
    assignedUnit: '',
    assigneeId: '',
    dueDate: '',
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.description.trim() || !form.requestingUnit.trim() || !form.assignedUnit.trim()) {
      toast.error(t('crossSell.toast.missingFieldsTitle', 'Missing fields'), {
        description: t('crossSell.toast.missingFieldsBody', 'Description and both units are required.'),
      });
      return;
    }
    create.mutate(
      {
        accountKey,
        description: form.description.trim(),
        requestingUnit: form.requestingUnit.trim(),
        assignedUnit: form.assignedUnit.trim(),
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        status: 'open',
      },
      {
        onSuccess: () => {
          toast.success(t('crossSell.toast.logged', 'Cross-sell action logged'));
          setOpen(false);
          setForm({ description: '', requestingUnit: '', assignedUnit: '', assigneeId: '', dueDate: '' });
        },
        onError: (err: Error) =>
          toast.error(t('crossSell.toast.saveError', 'Could not save'), { description: err.message }),
      },
    );
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('crossSell.logAction', 'Log action')}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="w-full space-y-2">
      <textarea
        autoFocus
        required
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder={t('crossSell.form.descriptionPlaceholder', 'What needs to happen?')}
        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
        rows={2}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          required
          value={form.requestingUnit}
          onChange={(e) => setForm((f) => ({ ...f, requestingUnit: e.target.value }))}
          placeholder={t('crossSell.form.requestingUnitPlaceholder', 'Requesting country/team')}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
        />
        <input
          required
          value={form.assignedUnit}
          onChange={(e) => setForm((f) => ({ ...f, assignedUnit: e.target.value }))}
          placeholder={t('crossSell.form.assignedUnitPlaceholder', 'Assigned country/team')}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
        />
        <select
          value={form.assigneeId}
          onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          aria-label={t('crossSell.form.assigneeLabel', 'Assignee')}
        >
          <option value="">{t('crossSell.form.unassigned', 'Unassigned')}</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          aria-label={t('crossSell.form.dueDateLabel', 'Due date')}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('crossSell.form.saving', 'Saving…') : t('crossSell.form.save', 'Save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t('crossSell.form.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}

export type { CrossSellAction };
