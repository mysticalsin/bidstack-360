import { useState } from 'react';

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
import type { WorkflowCreate } from '@bidstack/shared';
import { NewWorkflowDialog } from './workflowsPage/NewWorkflowDialog';

export function WorkflowsPage() {
  const [showActiveOnly, setShowActiveOnly] = useState<boolean | undefined>(undefined);
  const { data, isLoading, isError, error, refetch } = useWorkflows(showActiveOnly);

  const createWf = useCreateWorkflow();
  const updateWf = useUpdateWorkflow();
  const deleteWf = useDeleteWorkflow();
  const runWf = useRunWorkflow();
  const [showCreate, setShowCreate] = useState(false);

  const items = data?.items ?? [];

  const handleCreate = (body: WorkflowCreate) => {
    createWf.mutate(body, {
      onSuccess: () => {
        setShowCreate(false);
        toast.success('Workflow created');
      },
      onError: () => toast.error('Could not create workflow'),
    });
  };

  const handleToggle = (id: string, active: boolean) => {
    updateWf.mutate(
      { id, active: !active },
      {
        onSuccess: () => toast.success(active ? 'Workflow paused' : 'Workflow activated'),
        onError: () => toast.error('Could not update workflow'),
      },
    );
  };

  const handleRun = (id: string) => {
    runWf.mutate(id, {
      onSuccess: (run) => {
        if (run.status === 'succeeded') toast.success('Workflow ran successfully');
        else toast.error(`Workflow run ${run.status}${run.error ? `: ${run.error}` : ''}`);
      },
      onError: () => toast.error('Could not run workflow'),
    });
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete workflow?',
      description: `"${name}" will be removed. This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteWf.mutate(id, {
      onSuccess: () => toast.success('Workflow deleted'),
      onError: () => toast.error('Could not delete workflow'),
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Workflows</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
            <input
              type="checkbox"
              checked={showActiveOnly === true}
              onChange={(e) => setShowActiveOnly(e.target.checked ? true : undefined)}
              className="h-4 w-4 rounded border-[var(--border-subtle)]"
            />
            Active only
          </label>
          <Button onClick={() => setShowCreate(true)}>New workflow</Button>
        </div>
      </div>

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && data
          ? `${items.length} workflow${items.length === 1 ? '' : 's'}${showActiveOnly ? ' · active only' : ''}`
          : ''}
      </p>

      {isError ? (
        <ErrorState
          title="Failed to load workflows"
          message={error?.message}
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          message="Automate your pre-sales workflows."
          action={<Button onClick={() => setShowCreate(true)}>New workflow</Button>}
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
                <Badge tone={w.active ? 'jade' : 'gray'}>{w.active ? 'Active' : 'Inactive'}</Badge>
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
                <span>{w.runCount} runs</span>
                {w.lastRunAt && <span>Last run {new Date(w.lastRunAt).toLocaleDateString()}</span>}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-secondary)]">
                  <input
                    type="checkbox"
                    checked={w.active}
                    onChange={() => handleToggle(w.id, w.active)}
                    disabled={updateWf.isPending}
                    className="h-4 w-4 rounded border-[var(--border-subtle)]"
                  />
                  {w.active ? 'Active' : 'Paused'}
                </label>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRun(w.id)}
                    disabled={runWf.isPending}
                  >
                    {runWf.isPending ? 'Running…' : 'Run'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDelete(w.id, w.name)}
                    aria-label={`Delete workflow: ${w.name}`}
                    disabled={deleteWf.isPending}
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
