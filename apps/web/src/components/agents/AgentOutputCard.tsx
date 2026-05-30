import { useState } from 'react';
import type { RfpAgentOutput } from '@bidstack/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';

interface AgentOutputCardProps {
  output: RfpAgentOutput;
  onApprove?: (outputId: string) => void;
  onReject?: (outputId: string, reason: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

const STATUS_TONE: Record<string, 'jade' | 'amber' | 'tomato' | 'gray'> = {
  approved: 'jade',
  pending: 'amber',
  rejected: 'tomato',
};

export function AgentOutputCard({
  output,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: AgentOutputCardProps) {
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [expanded, setExpanded] = useState(false);

  const canAct = output.status === 'pending' && onApprove && onReject;

  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)] transition-all hover:shadow-[var(--shadow-md)] relative overflow-hidden',
        output.status === 'approved' && 'border-l-4 border-l-[var(--success)]',
        output.status === 'pending' && 'border-l-4 border-l-[var(--warning)]',
        output.status === 'rejected' && 'border-l-4 border-l-[var(--danger)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--fg-primary)]">
              {output.agentName}
            </span>
            <Badge tone={STATUS_TONE[output.status] ?? 'gray'}>{output.status}</Badge>
            {output.phase ? (
              <Badge tone="blue" className="text-[10px]">
                {output.phase}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-[var(--fg-tertiary)]">
            {new Date(output.createdAt).toLocaleString()}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded-lg p-1.5 text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <Icon name={expanded ? 'caretup' : 'caret'} size={16} />
        </button>
      </div>

      {output.confidenceScore !== null && (
        <div className="mt-2.5 flex items-center gap-2 select-none">
          <span className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">
            Confidence:
          </span>
          <div className="h-1.5 w-24 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                output.confidenceScore >= 0.8
                  ? 'bg-[var(--success)]'
                  : output.confidenceScore >= 0.5
                    ? 'bg-[var(--warning)]'
                    : 'bg-[var(--danger)]',
              )}
              style={{ width: `${output.confidenceScore * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-[var(--fg-secondary)]">
            {(output.confidenceScore * 100).toFixed(0)}%
          </span>
        </div>
      )}

      <div
        className={cn(
          'mt-3 text-sm text-[var(--fg-secondary)] leading-relaxed',
          !expanded && 'line-clamp-3',
        )}
      >
        {output.content}
      </div>

      {output.structuredData && expanded ? (
        <div className="mt-3 rounded-xl bg-[var(--surface-sunken)] p-3 border border-[var(--border-subtle)] animate-in fade-in duration-150">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)] flex items-center gap-1.5 select-none">
            <Icon name="settings" size={12} />
            Structured properties
          </div>
          <div className="space-y-1.5 font-mono text-xs max-h-56 overflow-y-auto">
            {Object.entries(output.structuredData).map(([key, val]) => (
              <div
                key={key}
                className="flex flex-col sm:flex-row sm:items-start border-b border-[var(--border-default)]/30 last:border-b-0 py-1"
              >
                <span
                  className="font-semibold text-[var(--fg-secondary)] w-full sm:w-1/3 shrink-0 truncate select-all"
                  title={key}
                >
                  {key}
                </span>
                <span className="text-[var(--fg-primary)] break-all flex-1">
                  {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canAct ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={isRejecting}
            onClick={() => setShowRejectDialog(true)}
          >
            <Icon name="close" size={14} className="mr-1" />
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isApproving}
            onClick={() => onApprove(output.id)}
          >
            <Icon name="checkCircle" size={14} className="mr-1" />
            Approve
          </Button>
        </div>
      ) : output.status === 'approved' ? (
        <div className="mt-3 text-xs text-[var(--success)] flex items-center gap-1">
          <Icon name="checkCircle" size={12} />
          Approved{output.approvedBy ? ` by ${output.approvedBy}` : ''}
        </div>
      ) : output.status === 'rejected' && output.rejectedReason ? (
        <div className="mt-3 text-xs text-[var(--danger)] flex items-center gap-1">
          <Icon name="warning" size={12} />
          Rejected: {output.rejectedReason}
        </div>
      ) : null}

      <Dialog open={showRejectDialog} onOpenChange={(open) => !open && setShowRejectDialog(false)}>
        <DialogContent title="Reject output">
          <div className="space-y-3">
            <p className="text-sm text-[var(--fg-secondary)]">
              Provide a reason so the agent can be re-run with corrections.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g., Missing citation for clause 3.2..."
              aria-label="Rejection reason"
              rows={3}
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowRejectDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!rejectReason.trim() || isRejecting}
                onClick={() => {
                  onReject?.(output.id, rejectReason.trim());
                  setShowRejectDialog(false);
                  setRejectReason('');
                }}
              >
                Reject output
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
