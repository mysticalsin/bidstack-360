/**
 * Cross-sell action log for the open account (A2). Structured, assignable
 * actions across countries/teams on a shared account; pre-sales owns it.
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { CrossSellStatusControls } from '@/components/account-intel/CrossSellStatusControls';
import { SourceBadge } from '@/components/cockpit/SourceBadge';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useUsers } from '@/hooks/useUsers';
import {
  useCreateCrossSellAction,
  useCrossSellActions,
  usePatchCrossSellAction,
} from '@/hooks/useCrossSell';
import type { CrossSellAction, GovernanceStatus } from '@bidstack/shared';

const STATUS_LABEL: Record<GovernanceStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
};

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function ActionAuditBadges({ action }: { action: CrossSellAction }) {
  const { t } = useTranslation('crm');
  const createdAt = dateOnly(action.createdAt);
  const updatedAt = dateOnly(action.updatedAt);
  const unknownDate = t('crossSell.audit.unknownDate', 'unknown date');

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <SourceBadge
        label={t('crossSell.audit.manualBadge', 'Manual action')}
        state="crm"
        hint={t(
          'crossSell.audit.manualHint',
          'Manually logged cross-sell action created {{createdAt}}.',
          { createdAt: createdAt ?? unknownDate },
        )}
        data-testid={`cross-sell-${action.id}-manual-source`}
      />
      <SourceBadge
        label={t('crossSell.audit.auditBadge', 'Audit logged')}
        state="verified"
        hint={t(
          'crossSell.audit.auditHint',
          'Server mutation audit covers create/update/delete events. Last updated {{updatedAt}}.',
          { updatedAt: updatedAt ?? unknownDate },
        )}
        data-testid={`cross-sell-${action.id}-audit-source`}
      />
    </div>
  );
}

export function CrossSellCard({ accountKey }: { accountKey: string }) {
  const actions = useCrossSellActions({ accountKey });
  const patch = usePatchCrossSellAction();
  const canWrite = useHasPermission('accounts:write');
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
                      {action.requestingUnit} -&gt; {action.assignedUnit}
                      {action.assigneeName ? ` - ${action.assigneeName}` : ''}
                      {action.dueDate ? ` - due ${action.dueDate.slice(0, 10)}` : ''}
                    </p>
                    <ActionAuditBadges action={action} />
                  </div>
                  <CrossSellStatusControls
                    action={action}
                    canWrite={canWrite}
                    isBusy={patch.isPending}
                    align="end"
                    className="shrink-0"
                    onStatusChange={(next) => {
                      patch.mutate(
                        { id: action.id, body: { status: next } },
                        {
                          onSuccess: () =>
                            toast.success(
                              t('crossSell.toast.statusAdvanced', 'Status: {{status}}', {
                                status: statusLabel(next),
                              }),
                            ),
                          onError: (err: Error) =>
                            toast.error(
                              t('crossSell.toast.statusError', 'Could not update status'),
                              { description: err.message },
                            ),
                        },
                      );
                    }}
                  />
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
  // Assignee picker: no server-side user search exists, so request the route
  // maximum (200) instead of the default 100 to avoid dropping assignees.
  const users = useUsers({ limit: 200 });
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
        description: t(
          'crossSell.toast.missingFieldsBody',
          'Description and both units are required.',
        ),
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
          setForm({
            description: '',
            requestingUnit: '',
            assignedUnit: '',
            assigneeId: '',
            dueDate: '',
          });
        },
        onError: (err: Error) =>
          toast.error(t('crossSell.toast.saveError', 'Could not save'), {
            description: err.message,
          }),
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
          {create.isPending
            ? t('crossSell.form.saving', 'Saving…')
            : t('crossSell.form.save', 'Save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t('crossSell.form.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}

export type { CrossSellAction };
