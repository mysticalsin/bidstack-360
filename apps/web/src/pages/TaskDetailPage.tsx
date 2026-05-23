import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useTasks, useUpdateTask } from '@/hooks/useTasks';
import { formatDate } from '@/lib/format';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tasks = useTasks();
  const update = useUpdateTask();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');

  const task = tasks.data?.items.find((t) => t.id === id);

  if (tasks.isLoading) return <LoadingSkeleton rows={6} />;
  if (tasks.isError)
    return (
      <ErrorState
        title="Failed to load task"
        message={tasks.error instanceof Error ? tasks.error.message : 'Something went wrong'}
      />
    );
  if (!task)
    return <EmptyState title="Task not found" message="This task may have been deleted." />;

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
    if (Object.keys(patch).length > 0) {
      update.mutate({ id: task.id, patch });
    }
    setEditing(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <header className="flex items-start justify-between">
        <div>
          {editing ? (
            <input
              className="input text-xl font-bold w-full"
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
                Opportunity
              </Link>
            )}
            {task.assignee && <span>Assigned to {task.assignee}</span>}
            <span>Due {task.dueDate ? formatDate(task.dueDate) : 'no date'}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={update.isPending}>
                Save
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={startEdit}>
              Edit
            </Button>
          )}
        </div>
      </header>

      <Card className="p-5">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--fg-secondary)]">Status</span>
            {editing ? (
              <select
                className="input text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
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
            <span className="text-sm text-[var(--fg-secondary)]">ID</span>
            <span className="text-sm text-[var(--fg-primary)] font-mono">
              {task.id.slice(0, 8)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--fg-secondary)]">Created</span>
            <span className="text-sm text-[var(--fg-primary)]">{formatDate(task.createdAt)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
