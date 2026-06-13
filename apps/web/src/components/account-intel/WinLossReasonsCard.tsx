/**
 * Win/Loss reason capture + pattern flagging. Core value prop: managers don't
 * document WHY deals are won/lost. This records a reason per closed deal and
 * surfaces the org-wide pattern (e.g. "most losses are price").
 */
import { useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { useUpsertWinLoss, useWinLossPatterns } from '@/hooks/useWinLoss';
import type { WinLossOutcome, WinLossReasonCode } from '@bidstack/shared';

const REASON_LABEL: Record<WinLossReasonCode, string> = {
  price: 'Price',
  product_fit: 'Product fit',
  timing: 'Timing',
  competitor: 'Competitor',
  relationship: 'Relationship',
  scope: 'Scope',
  no_decision: 'No decision',
  other: 'Other',
};
const REASONS = Object.keys(REASON_LABEL) as WinLossReasonCode[];

const inputCls = 'rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm';

export interface ClosedOpp {
  id: string;
  name: string;
  outcome: WinLossOutcome;
}

export function WinLossReasonsCard({ closedOpps }: { closedOpps: ClosedOpp[] }) {
  const patterns = useWinLossPatterns();
  const canWrite = useIsAdmin();

  return (
    <Card role="region" aria-label="Win/loss reasons">
      <SectionHeader
        title="Win / loss reasons"
        caption="Why deals close — and the pattern across the org"
      />
      <div className="px-5 pb-5 space-y-4">
        {patterns.isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : patterns.isError ? (
          <ErrorState
            title="Could not load win/loss patterns"
            message={patterns.error?.message ?? 'Try again shortly.'}
          />
        ) : (
          <div>
            <p className="text-sm text-[var(--fg-secondary)]">
              {patterns.data!.totalWon} won · {patterns.data!.totalLost} lost recorded
            </p>
            {patterns.data!.topLossReason ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-[var(--fg-primary)]">
                <Badge tone="tomato">Pattern</Badge>
                Most losses cite <strong>{REASON_LABEL[patterns.data!.topLossReason]}</strong>.
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--fg-tertiary)]">
                No loss reasons recorded yet — capture a few to surface patterns.
              </p>
            )}
            {patterns.data!.rows.filter((r) => r.outcome === 'lost').length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {patterns.data!.rows
                  .filter((r) => r.outcome === 'lost')
                  .sort((a, b) => b.count - a.count)
                  .map((r) => (
                    <li key={r.reason}>
                      <Badge tone="gray">
                        {REASON_LABEL[r.reason]} · {r.count}
                      </Badge>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {canWrite && closedOpps.length > 0 && <CaptureForm closedOpps={closedOpps} />}
      </div>
    </Card>
  );
}

function CaptureForm({ closedOpps }: { closedOpps: ClosedOpp[] }) {
  const upsert = useUpsertWinLoss();
  const [oppId, setOppId] = useState('');
  const [reason, setReason] = useState<WinLossReasonCode>('price');
  const [competitor, setCompetitor] = useState('');
  const [note, setNote] = useState('');

  const selectedOpp = closedOpps.find((o) => o.id === oppId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedOpp) {
      toast.error('Pick a closed deal first');
      return;
    }
    upsert.mutate(
      {
        opportunityId: selectedOpp.id,
        body: {
          outcome: selectedOpp.outcome,
          reason,
          competitor: competitor.trim() || null,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Reason recorded');
          setOppId('');
          setCompetitor('');
          setNote('');
        },
        onError: (err: Error) => toast.error('Could not save', { description: err.message }),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2 border-t border-[var(--border)] pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
        Record a reason
      </p>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={oppId}
          onChange={(e) => setOppId(e.target.value)}
          className={inputCls}
          aria-label="Closed deal"
        >
          <option value="">Select a closed deal…</option>
          {closedOpps.map((o) => (
            <option key={o.id} value={o.id}>
              {o.outcome === 'won' ? '✓ ' : '✗ '}
              {o.name}
            </option>
          ))}
        </select>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as WinLossReasonCode)}
          className={inputCls}
          aria-label="Reason"
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </select>
        <input
          value={competitor}
          onChange={(e) => setCompetitor(e.target.value)}
          placeholder="Competitor (optional)"
          className={inputCls}
          aria-label="Competitor"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className={inputCls}
          aria-label="Note"
        />
      </div>
      <Button type="submit" disabled={!oppId || upsert.isPending}>
        {upsert.isPending ? 'Saving…' : 'Record reason'}
      </Button>
    </form>
  );
}
