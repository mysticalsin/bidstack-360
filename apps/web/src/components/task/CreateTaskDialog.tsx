// Create-task dialog. Used from both the Tasks page (no opp pre-filled)
// and the opportunity detail view (oppId provided). Validates client-side
// before round-tripping to /api/tasks; the server re-validates via Zod.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useCreateTask } from '@/hooks/useTasks';
import type { TaskStatus } from '@bidstack/shared';

interface Props {
  /** Optional pre-filled opportunity id (when invoked from a record page). */
  oppId?: string;
  /** Optional trigger element. Defaults to a primary button "+ New task". */
  trigger?: React.ReactNode;
  /**
   * Controlled open state. When provided, the caller owns open/close.
   * Used by the command palette contextual action (Twenty pattern A3).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateTaskDialog({ oppId, trigger, open: controlledOpen, onOpenChange }: Props) {
  const { t } = useTranslation('crm');
  const [internalOpen, setInternalOpen] = useState(false);
  // Support both controlled (command palette) and uncontrolled (trigger button) modes.
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;
  const create = useCreateTask();
  const opps = useOpportunities({ limit: 100 });

  const [title, setTitle] = useState('');
  const [linkedOppId, setLinkedOppId] = useState<string>(oppId ?? '');
  const [dueDate, setDueDate] = useState<string>('');
  const [status, setStatus] = useState<TaskStatus>('open');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setLinkedOppId(oppId ?? '');
    setDueDate('');
    setStatus('open');
    setError(null);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(t('createTask.errorTitleRequired', 'Title is required'));
      return;
    }
    try {
      await create.mutateAsync({
        title: cleanTitle,
        oppId: linkedOppId || null,
        dueDate: dueDate || null,
        status,
        assignee: null,
      });
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('createTask.errorSaveFailed', 'Save failed'));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <button type="button" className="btn btn-primary">
            {t('createTask.triggerButton', '+ New task')}
          </button>
        )}
      </DialogTrigger>
      {open ? (
        <DialogContent
          title={t('createTask.dialogTitle', 'New task')}
          description={t(
            'createTask.dialogDescription',
            'Create a follow-up — optionally linked to an opportunity.',
          )}
        >
          <form onSubmit={submit} className="space-y-3">
            <Field label={t('createTask.fieldTitle', 'Title')} htmlFor="task-title" required>
              <input
                id="task-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                autoFocus
                className="dialog-input"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('createTask.fieldOpportunity', 'Opportunity')} htmlFor="task-opp">
                <Select
                  id="task-opp"
                  value={linkedOppId}
                  onChange={(e) => setLinkedOppId(e.target.value)}
                >
                  <option value="">{t('createTask.opportunityNone', '— None —')}</option>
                  {opps.data?.items.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.code} · {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('createTask.fieldStatus', 'Status')} htmlFor="task-status">
                <Select
                  id="task-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                >
                  <option value="open">{t('createTask.statusOpen', 'Open')}</option>
                  <option value="in_progress">
                    {t('createTask.statusInProgress', 'In progress')}
                  </option>
                  <option value="blocked">{t('createTask.statusBlocked', 'Blocked')}</option>
                  <option value="done">{t('createTask.statusDone', 'Done')}</option>
                </Select>
              </Field>
            </div>

            <Field label={t('createTask.fieldDueDate', 'Due date')} htmlFor="task-due">
              <input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="dialog-input"
              />
            </Field>

            {error ? (
              <p role="alert" className="text-xs text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={create.isPending}
              >
                {t('createTask.cancelButton', 'Cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                {create.isPending
                  ? t('createTask.savingButton', 'Saving…')
                  : t('createTask.submitButton', 'Create task')}
              </Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </span>
      {children}
    </label>
  );
}
