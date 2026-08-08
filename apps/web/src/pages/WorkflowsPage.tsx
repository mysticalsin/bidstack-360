import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import {
  useCreateWorkflow,
  useDeleteWorkflow,
  useRunWorkflow,
  useUpdateWorkflow,
  useWorkflows,
} from '@/hooks/useWorkflows';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { confirm } from '@/components/ui/ConfirmDialog';
import { useHasPermission } from '@/hooks/useCapabilities';
import type { WorkflowCreate } from '@bidstack/shared';
import { NewWorkflowDialog } from './workflowsPage/NewWorkflowDialog';

export function WorkflowsPage() {
  const { t } = useTranslation('crm');
  const [showActiveOnly, setShowActiveOnly] = useState<boolean | undefined>(undefined);
  const { data, isLoading, isError, error, refetch } = useWorkflows(showActiveOnly);

  const createWf = useCreateWorkflow();
  const updateWf = useUpdateWorkflow();
  const deleteWf = useDeleteWorkflow();
  const runWf = useRunWorkflow();
  const [showCreate, setShowCreate] = useState(false);
  // Create/toggle/run/delete all PATCH or POST through /api/workflows, gated
  // server-side behind workflows:write — hide the primary CTA, disable the
  // per-card affordances (matches ReportsListPage/TerritoriesPage) so a
  // read-only viewer sees the workflow list without a 403-on-click trap.
  const canWrite = useHasPermission('workflows:write');
  const readOnlyHint = t(
    'workflows.readOnlyHint',
    'You need workflows write access to manage this workflow.',
  );

  const items = data?.items ?? [];

  const handleCreate = (body: WorkflowCreate) => {
    createWf.mutate(body, {
      onSuccess: () => {
        setShowCreate(false);
        toast.success(t('workflows.toastCreated', 'Workflow created'));
      },
      onError: () => toast.error(t('workflows.toastCreateError', 'Could not create workflow')),
    });
  };

  const handleToggle = (id: string, active: boolean) => {
    updateWf.mutate(
      { id, active: !active },
      {
        onSuccess: () =>
          toast.success(
            active
              ? t('workflows.toastPaused', 'Workflow paused')
              : t('workflows.toastActivated', 'Workflow activated'),
          ),
        onError: () => toast.error(t('workflows.toastUpdateError', 'Could not update workflow')),
      },
    );
  };

  const handleRun = (id: string) => {
    runWf.mutate(id, {
      onSuccess: (run) => {
        if (run.status === 'succeeded')
          toast.success(t('workflows.toastRunSuccess', 'Workflow ran successfully'));
        else
          toast.error(
            t('workflows.toastRunFailed', 'Workflow run {{status}}{{detail}}', {
              status: run.status,
              detail: run.error ? `: ${run.error}` : '',
            }),
          );
      },
      onError: () => toast.error(t('workflows.toastRunError', 'Could not run workflow')),
    });
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: t('workflows.deleteConfirmTitle', 'Delete workflow?'),
      description: t(
        'workflows.deleteConfirmDescription',
        '"{{name}}" will be removed. This can\'t be undone.',
        { name },
      ),
      confirmLabel: t('workflows.deleteConfirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    deleteWf.mutate(id, {
      onSuccess: () => toast.success(t('workflows.toastDeleted', 'Workflow deleted')),
      onError: () => toast.error(t('workflows.toastDeleteError', 'Could not delete workflow')),
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t('workflows.pageTitle', 'Workflows')}</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
            <input
              type="checkbox"
              checked={showActiveOnly === true}
              onChange={(e) => setShowActiveOnly(e.target.checked ? true : undefined)}
              className="h-4 w-4 rounded border-[var(--border-subtle)]"
            />
            {t('workflows.activeOnly', 'Active only')}
          </label>
          {canWrite && (
            <Button onClick={() => setShowCreate(true)}>
              {t('workflows.newWorkflow', 'New workflow')}
            </Button>
          )}
        </div>
      </div>

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && data
          ? `${
              items.length === 1
                ? t('workflows.countOne', '{{count}} workflow', { count: items.length })
                : t('workflows.countOther', '{{count}} workflows', { count: items.length })
            }${showActiveOnly ? t('workflows.activeOnlySuffix', ' · active only') : ''}`
          : ''}
      </p>

      {isError ? (
        <ErrorState
          title={t('workflows.errorTitle', 'Failed to load workflows')}
          message={error?.message}
          action={<Button onClick={() => refetch()}>{t('workflows.retry', 'Retry')}</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('workflows.emptyTitle', 'No workflows yet')}
          message={t('workflows.emptyMessage', 'Automate your pre-sales workflows.')}
          action={
            canWrite ? (
              <Button onClick={() => setShowCreate(true)}>
                {t('workflows.newWorkflow', 'New workflow')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{w.name}</h3>
                  {w.description && (
                    <p className="mt-1 text-xs text-[var(--fg-secondary)]">{w.description}</p>
                  )}
                </div>
                <Badge tone={w.active ? 'jade' : 'gray'}>
                  {w.active
                    ? t('workflows.statusActive', 'Active')
                    : t('workflows.statusInactive', 'Inactive')}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="blue">{w.triggerKind.replace(/_/g, ' ')}</Badge>
                {w.actions.map((a) => (
                  <Badge key={a.id} tone="purple">
                    {a.kind.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-[var(--fg-tertiary)]">
                <span>{t('workflows.runCount', '{{count}} runs', { count: w.runCount })}</span>
                {w.lastRunAt && (
                  <span>
                    {t('workflows.lastRun', 'Last run {{date}}', {
                      date: new Date(w.lastRunAt).toLocaleDateString(),
                    })}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                <label
                  className="flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-secondary)]"
                  title={canWrite ? undefined : readOnlyHint}
                >
                  <input
                    type="checkbox"
                    checked={w.active}
                    onChange={() => handleToggle(w.id, w.active)}
                    disabled={updateWf.isPending || !canWrite}
                    aria-label={
                      canWrite
                        ? undefined
                        : `${
                            w.active
                              ? t('workflows.statusActive', 'Active')
                              : t('workflows.statusPaused', 'Paused')
                          } — ${readOnlyHint}`
                    }
                    className="h-4 w-4 rounded border-[var(--border-subtle)]"
                  />
                  {w.active
                    ? t('workflows.statusActive', 'Active')
                    : t('workflows.statusPaused', 'Paused')}
                </label>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRun(w.id)}
                    disabled={runWf.isPending || !canWrite}
                    title={canWrite ? undefined : readOnlyHint}
                    aria-label={
                      canWrite ? undefined : `${t('workflows.run', 'Run')} — ${readOnlyHint}`
                    }
                  >
                    {runWf.isPending
                      ? t('workflows.running', 'Running…')
                      : t('workflows.run', 'Run')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDelete(w.id, w.name)}
                    aria-label={
                      canWrite
                        ? t('workflows.deleteAriaLabel', 'Delete workflow: {{name}}', { name: w.name })
                        : `${t('workflows.deleteAriaLabel', 'Delete workflow: {{name}}', { name: w.name })} — ${readOnlyHint}`
                    }
                    disabled={deleteWf.isPending || !canWrite}
                    title={canWrite ? undefined : readOnlyHint}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] disabled:opacity-50 pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]"
                  >
                    <Icon name="trash" size={15} ariaHidden />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <NewWorkflowDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          isPending={createWf.isPending}
        />
      )}
    </div>
  );
}
