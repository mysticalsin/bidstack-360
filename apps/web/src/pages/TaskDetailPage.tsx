import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useTasks, useUpdateTask } from '@/hooks/useTasks';
import { CustomFieldValuesSection } from '@/components/CustomFieldValuesSection';
import { formatDate } from '@/lib/format';

export function TaskDetailPage() {
  const { t } = useTranslation('crm');
  const { id } = useParams<{ id: string }>();
  const tasks = useTasks();
  const update = useUpdateTask();
  // PATCH /api/tasks/:id is gated server-side behind tasks:write — disable the
  // Edit entry point instead of letting the user fill out a form that 403s on
  // save (matches CompanyDetailsForm's canWrite convention).
  const canWrite = useHasPermission('tasks:write');
  const readOnlyHint = t('taskDetail.readOnlyHint', 'You need task write access to edit this task.');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');

  const task = tasks.data?.items.find((t) => t.id === id);

  if (tasks.isLoading) return <LoadingSkeleton rows={6} />;
  if (tasks.isError)
    return (
      <ErrorState
        title={t('taskDetail.errorTitle', 'Failed to load task')}
        message={
          tasks.error instanceof Error
            ? tasks.error.message
            : t('taskDetail.errorMessage', 'Something went wrong')
        }
      />
    );
  if (!task)
    return (
      <EmptyState
        title={t('taskDetail.notFoundTitle', 'Task not found')}
        message={t('taskDetail.notFoundMessage', 'This task may have been deleted.')}
      />
    );

  const startEdit = () => {
    setTitle(task.title);
    setStatus(task.status);
    setEditing(true);
  };

  const save = () => {
    const patch: { title?: string; status?: 'open' | 'in_progress' | 'done' | 'blocked' } = {};
    if (title !== task.title) patch.title = title;
    if (status !== task.status)
      patch.status = status as 'open' | 'in_progress' | 'done' | 'blocked';
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    // Close the editor only once the save actually lands — mirroring
    // TaskRow.tsx's cycle()/snoozeTo() — otherwise a 4xx/5xx (e.g. invalid
    // status) silently reverts the optimistic UI with no feedback.
    update.mutate(
      { id: task.id, patch },
      {
        onSuccess: () => setEditing(false),
        onError: (err) =>
          toast.error(t('taskDetail.toast.updateFailedTitle', 'Could not update task'), {
            description:
              err instanceof Error
                ? err.message
                : t('taskDetail.toast.serverRejected', 'The server rejected the request.'),
          }),
      },
    );
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <header className="flex items-start justify-between">
        <div>
          {editing ? (
            <input
              className="input text-xl font-bold w-full"
              aria-label={t('taskDetail.titleAriaLabel', 'Task title')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          ) : (
            <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
              {task.title}
            </h1>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--fg-secondary)]">
            {task.oppId && (
              <Link
                to={`/opportunities/${task.oppId}`}
                className="hover:text-[var(--brand-primary)]"
              >
                {t('taskDetail.opportunityLink', 'Opportunity')}
              </Link>
            )}
            {task.assignee && (
              <span>
                {t('taskDetail.assignedTo', 'Assigned to {{assignee}}', {
                  assignee: task.assignee,
                })}
              </span>
            )}
            <span>
              {t('taskDetail.due', 'Due {{date}}', {
                date: task.dueDate
                  ? formatDate(task.dueDate)
                  : t('taskDetail.noDate', 'no date'),
              })}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                {t('taskDetail.cancel', 'Cancel')}
              </Button>
              <Button size="sm" onClick={save} disabled={update.isPending}>
                {t('taskDetail.save', 'Save')}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={startEdit}
              disabled={!canWrite}
              title={canWrite ? undefined : readOnlyHint}
              aria-label={
                canWrite ? undefined : `${t('taskDetail.edit', 'Edit')} — ${readOnlyHint}`
              }
            >
              {t('taskDetail.edit', 'Edit')}
            </Button>
          )}
        </div>
      </header>

      <CustomFieldValuesSection entityType="task" entityId={id!} />

      <Card className="p-5">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--fg-secondary)]">
              {t('taskDetail.statusLabel', 'Status')}
            </span>
            {editing ? (
              <select
                className="input text-sm"
                aria-label={t('taskDetail.statusAriaLabel', 'Status')}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="open">{t('taskDetail.statusOpen', 'Open')}</option>
                <option value="in_progress">
                  {t('taskDetail.statusInProgress', 'In Progress')}
                </option>
                <option value="blocked">{t('taskDetail.statusBlocked', 'Blocked')}</option>
                <option value="done">{t('taskDetail.statusDone', 'Done')}</option>
              </select>
            ) : (
              <Badge
                tone={
                  task.status === 'done'
                    ? 'jade'
                    : task.status === 'in_progress'
                      ? 'blue'
                      : task.status === 'blocked'
                        ? 'tomato'
                        : 'gray'
                }
              >
                {task.status.replace('_', ' ')}
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--fg-secondary)]">
              {t('taskDetail.idLabel', 'ID')}
            </span>
            <span className="text-sm text-[var(--fg-primary)] font-mono">
              {task.id.slice(0, 8)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--fg-secondary)]">
              {t('taskDetail.createdLabel', 'Created')}
            </span>
            <span className="text-sm text-[var(--fg-primary)]">{formatDate(task.createdAt)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
