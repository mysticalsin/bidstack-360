// Controlled dialog for authoring a workflow: name, trigger, and an ordered
// list of action steps. Wired to POST /api/workflows. Per-action configuration
// (email body, webhook URL, etc.) uses backend defaults here — this dialog
// creates the runnable skeleton; fine-grained config is a separate editor.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { WorkflowActionKind, WorkflowTriggerKind, type WorkflowCreate } from '@bidstack/shared';

// Only triggers/actions the engine actually fires are selectable — creating a
// workflow with an unwired kind would produce a dead automation. UNWIRED and
// hidden until implemented: triggers record_updated, webhook_received; actions
// send_email, send_slack, run_dust_agent.
const WIRED_TRIGGERS = ['record_created', 'stage_changed', 'schedule', 'manual'] as const;
const WIRED_ACTIONS = [
  'create_task',
  'create_notification',
  'call_webhook',
  'assign_owner',
  'update_field',
] as const;

const triggerLabel = (t: TFunction, kind: string): string => {
  const labels: Record<string, string> = {
    record_created: t('newWorkflow.triggerRecordCreated', 'When a record is created'),
    record_updated: t('newWorkflow.triggerRecordUpdated', 'When a record is updated'),
    stage_changed: t('newWorkflow.triggerStageChanged', 'When a stage changes'),
    schedule: t('newWorkflow.triggerSchedule', 'On a schedule'),
    webhook_received: t('newWorkflow.triggerWebhookReceived', 'When a webhook is received'),
    manual: t('newWorkflow.triggerManual', 'Manually / on demand'),
  };
  return labels[kind] ?? kind;
};

const actionLabel = (t: TFunction, kind: string): string => {
  const labels: Record<string, string> = {
    send_email: t('newWorkflow.actionSendEmail', 'Send email'),
    send_slack: t('newWorkflow.actionSendSlack', 'Send Slack message'),
    create_task: t('newWorkflow.actionCreateTask', 'Create task'),
    update_field: t('newWorkflow.actionUpdateField', 'Update field'),
    call_webhook: t('newWorkflow.actionCallWebhook', 'Call webhook'),
    assign_owner: t('newWorkflow.actionAssignOwner', 'Assign owner'),
    run_dust_agent: t('newWorkflow.actionRunDustAgent', 'Run Dust agent'),
    create_notification: t('newWorkflow.actionCreateNotification', 'Create notification'),
  };
  return labels[kind] ?? kind;
};

interface Props {
  onClose: () => void;
  onCreate: (body: WorkflowCreate) => void;
  isPending: boolean;
}

export function NewWorkflowDialog({ onClose, onCreate, isPending }: Props) {
  const { t } = useTranslation('crm');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerKind, setTriggerKind] = useState<WorkflowTriggerKind>('record_created');
  const [actions, setActions] = useState<WorkflowActionKind[]>(['create_task']);
  const [nameError, setNameError] = useState<string | undefined>();

  const setAction = (index: number, kind: WorkflowActionKind) =>
    setActions((prev) => prev.map((v, i) => (i === index ? kind : v)));
  const addAction = () => setActions((prev) => [...prev, 'create_task']);
  const removeAction = (index: number) => setActions((prev) => prev.filter((_, i) => i !== index));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t('newWorkflow.nameRequiredError', 'A workflow name is required.'));
      return;
    }
    setNameError(undefined);
    onCreate({
      name: name.trim(),
      description: description.trim() || null,
      active: true,
      triggerKind,
      triggerConfig: {},
      actions: actions.map((kind, i) => ({ kind, config: {}, sortOrder: i })),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t('newWorkflow.dialogTitle', 'New workflow')}
        description={t(
          'newWorkflow.dialogDescription',
          'Pick a trigger and the actions to run when it fires. You can fine-tune each step after the workflow exists.',
        )}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            label={t('newWorkflow.nameLabel', 'Workflow name')}
            placeholder={t(
              'newWorkflow.namePlaceholder',
              'Notify owner when a deal reaches Negotiation',
            )}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            aria-required="true"
            disabled={isPending}
          />

          <div className="flex flex-col gap-1">
            <label htmlFor="wf-trigger" className="text-xs font-medium text-[var(--fg-secondary)]">
              {t('newWorkflow.triggerLabel', 'Trigger')}
            </label>
            <select
              id="wf-trigger"
              className="input w-full"
              value={triggerKind}
              onChange={(e) => setTriggerKind(e.target.value as WorkflowTriggerKind)}
              disabled={isPending}
            >
              {WorkflowTriggerKind.options
                .filter((kind) => (WIRED_TRIGGERS as readonly string[]).includes(kind))
                .map((kind) => (
                  <option key={kind} value={kind}>
                    {triggerLabel(t, kind)}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[var(--fg-secondary)]">
              {t('newWorkflow.actionsLabel', 'Actions')}
            </span>
            {actions.map((action, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[10px] font-semibold text-[var(--fg-tertiary)]"
                >
                  {i + 1}
                </span>
                <select
                  className="input flex-1"
                  aria-label={t('newWorkflow.actionSelectAriaLabel', 'Action {{number}}', {
                    number: i + 1,
                  })}
                  value={action}
                  onChange={(e) => setAction(i, e.target.value as WorkflowActionKind)}
                  disabled={isPending}
                >
                  {WorkflowActionKind.options
                    .filter((kind) => (WIRED_ACTIONS as readonly string[]).includes(kind))
                    .map((kind) => (
                      <option key={kind} value={kind}>
                        {actionLabel(t, kind)}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeAction(i)}
                  aria-label={t('newWorkflow.removeActionAriaLabel', 'Remove action {{number}}', {
                    number: i + 1,
                  })}
                  disabled={isPending || actions.length === 1}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] disabled:opacity-40 pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]"
                >
                  <Icon name="trash" size={14} ariaHidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addAction}
              disabled={isPending || actions.length >= 50}
              className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs font-medium text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-tint)] disabled:opacity-50"
            >
              <Icon name="plus" size={14} ariaHidden />
              {t('newWorkflow.addAction', 'Add action')}
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="wf-desc" className="text-xs font-medium text-[var(--fg-secondary)]">
              {t('newWorkflow.descriptionLabel', 'Description')}
            </label>
            <textarea
              id="wf-desc"
              className="input w-full min-h-[64px]"
              placeholder={t(
                'newWorkflow.descriptionPlaceholder',
                'What this workflow does and when it should run…',
              )}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={isPending}>
              {t('newWorkflow.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t('newWorkflow.creating', 'Creating…')
                : t('newWorkflow.submit', 'Create workflow')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
