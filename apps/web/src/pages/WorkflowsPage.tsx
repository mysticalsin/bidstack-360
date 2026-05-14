import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { useWorkflows } from '@/hooks/useWorkflows';
import { Badge } from '@/components/ui/Badge';

export function WorkflowsPage() {
  const [showActiveOnly, setShowActiveOnly] = useState<boolean | undefined>(undefined);
  const { data, isLoading, isError, error, refetch } = useWorkflows(showActiveOnly);

  const items = data?.items ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Workflows</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
            <input
              type="checkbox"
              checked={showActiveOnly === true}
              onChange={(e) => setShowActiveOnly(e.target.checked ? true : undefined)}
              className="h-4 w-4 rounded border-[var(--border-subtle)]"
            />
            Active only
          </label>
        </div>
      </div>

      {isError ? (
        <ErrorState
          title="Failed to load workflows"
          message={error?.message}
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState title="No workflows yet" message="Automate your CRM with workflows." />
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
