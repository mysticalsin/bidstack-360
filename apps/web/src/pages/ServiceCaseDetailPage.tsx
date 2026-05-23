import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useServiceCase, useUpdateServiceCase } from '@/hooks/useServiceCases';

const STATUS_FLOW: Record<string, string[]> = {
  new: ['open'],
  open: ['pending', 'resolved'],
  pending: ['open', 'resolved'],
  resolved: ['closed'],
  closed: [],
};

export function ServiceCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const c = useServiceCase(id);
  const update = useUpdateServiceCase();
  const [note, setNote] = useState('');

  if (c.isLoading) return <LoadingSkeleton rows={6} />;
  if (c.isError)
    return (
      <ErrorState
        title="Failed to load case"
        message={c.error instanceof Error ? c.error.message : 'Something went wrong'}
      />
    );
  if (!c.data)
    return <EmptyState title="Case not found" message="This case may have been deleted." />;
  const cs = c.data;

  const transitions = STATUS_FLOW[cs.status] ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
              {cs.number}
            </h1>
            <Badge
              tone={
                cs.status === 'closed'
                  ? 'gray'
                  : cs.status === 'resolved'
                    ? 'jade'
                    : cs.priority === 'high'
                      ? 'rose'
                      : 'amber'
              }
            >
              {cs.status}
            </Badge>
          </div>
          <p className="mt-1 text-lg text-[var(--fg-primary)]">{cs.subject}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--fg-secondary)]">
            {cs.ownerName && <span>Owner: {cs.ownerName}</span>}
            <span>Priority: {cs.priority}</span>
            <span>Source: {cs.source}</span>
            {cs.slaDeadline && (
              <span className={new Date(cs.slaDeadline) < new Date() ? 'text-[var(--rose-9)]' : ''}>
                SLA: {new Date(cs.slaDeadline).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {transitions.map((s) => (
            <Button
              key={s}
              size="sm"
              onClick={() => update.mutate({ id: cs.id, body: { status: s as never } })}
              disabled={update.isPending}
            >
              Mark {s}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5">
            <h3 className="text-sm font-medium text-[var(--fg-secondary)] mb-2">Description</h3>
            <p className="text-[var(--fg-primary)] whitespace-pre-wrap">
              {cs.description ?? 'No description provided.'}
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-medium text-[var(--fg-secondary)] mb-2">Add note</h3>
            <textarea
              className="input w-full min-h-[80px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Write an internal note…"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" disabled>
                Save note
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-medium text-[var(--fg-secondary)] mb-3">Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--fg-tertiary)]">Created</span>
                <span className="text-[var(--fg-primary)]">
                  {new Date(cs.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--fg-tertiary)]">Updated</span>
                <span className="text-[var(--fg-primary)]">
                  {new Date(cs.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {cs.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--fg-tertiary)]">Resolved</span>
                  <span className="text-[var(--fg-primary)]">
                    {new Date(cs.resolvedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
              {cs.closedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--fg-tertiary)]">Closed</span>
                  <span className="text-[var(--fg-primary)]">
                    {new Date(cs.closedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
