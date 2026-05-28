import { useState } from 'react';
import type { RfpAgentOutput } from '@bidstack/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Dialog, DialogContent } from '@/components/ui/Dialog';

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
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
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
            {output.confidenceScore !== null
              ? ` · Confidence ${(output.confidenceScore * 100).toFixed(0)}%`
              : null}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded-lg p-1.5 text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
      </div>

      <div className={`mt-3 text-sm text-[var(--fg-secondary)] ${expanded ? '' : 'line-clamp-3'}`}>
        {output.content}
      </div>

      {output.structuredData && expanded ? (
        <div className="mt-3 rounded-xl bg-[var(--surface-sunken)] p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
            Structured data
          </div>
          <pre className="max-h-48 overflow-auto text-xs text-[var(--fg-secondary)]">
            {JSON.stringify(output.structuredData, null, 2)}
          </pre>
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
            <Icon name="x-circle" size={14} className="mr-1" />
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isApproving}
            onClick={() => onApprove(output.id)}
          >
            <Icon name="check-circle" size={14} className="mr-1" />
            Approve
          </Button>
        </div>
      ) : output.status === 'approved' ? (
        <div className="mt-3 text-xs text-[var(--success)]">
          Approved{output.approvedBy ? ` by ${output.approvedBy}` : ''}
        </div>
      ) : output.status === 'rejected' && output.rejectedReason ? (
        <div className="mt-3 text-xs text-[var(--danger)]">Rejected: {output.rejectedReason}</div>
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
