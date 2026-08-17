// Stage 10 — Lessons Learned, on the record it belongs to.
//
// The Amaris playbook closes the lifecycle with a debrief: win/loss factors
// documented within 5 business days of the award. The data model for it
// (WinLossRecord) already existed, but the only capture form in the product sat
// on the account dashboard behind an admin flag, and useWinLossRecord was dead
// code — so a recorded reason was never shown on the opportunity it described.
// This card is that missing surface: it renders only for a CLOSED opportunity,
// shows the standing debrief, and lets whoever can edit the opportunity write
// or revise it.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LESSONS_LEARNED_SLA_BUSINESS_DAYS,
  type WinLossOutcome,
  type WinLossReasonCode,
} from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useWinLossRecord, useUpsertWinLoss } from '@/hooks/useWinLoss';

const REASONS: WinLossReasonCode[] = [
  'price',
  'product_fit',
  'timing',
  'competitor',
  'relationship',
  'scope',
  'no_decision',
  'other',
];

const inputCls =
  'w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-1.5 text-xs text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]';

interface Props {
  opportunityId: string;
  /** Null when the opportunity is still open — the card renders nothing. */
  outcome: WinLossOutcome | null;
}

export function LessonsLearnedCard({ opportunityId, outcome }: Props) {
  const { t } = useTranslation('crm');
  const canWrite = useHasPermission('opportunities:write');
  const record = useWinLossRecord(outcome ? opportunityId : null);
  const upsert = useUpsertWinLoss();

  const reasonLabel: Record<WinLossReasonCode, string> = {
    price: t('lessonsLearned.reasonPrice', 'Price'),
    product_fit: t('lessonsLearned.reasonProductFit', 'Product fit'),
    timing: t('lessonsLearned.reasonTiming', 'Timing'),
    competitor: t('lessonsLearned.reasonCompetitor', 'Competitor'),
    relationship: t('lessonsLearned.reasonRelationship', 'Relationship'),
    scope: t('lessonsLearned.reasonScope', 'Scope'),
    no_decision: t('lessonsLearned.reasonNoDecision', 'No decision'),
    other: t('lessonsLearned.reasonOther', 'Other'),
  };

  // The debrief only exists after the award — an open bid has nothing to learn
  // from yet, and forcing the card onto every opportunity would be noise.
  if (!outcome) return null;

  return (
    <Card>
      <SectionHeader
        title={t('lessonsLearned.title', 'Lessons Learned')}
        caption={t(
          'lessonsLearned.caption',
          'Stage 10 — document the win/loss factors within {{days}} business days of the award.',
          { days: LESSONS_LEARNED_SLA_BUSINESS_DAYS },
        )}
      />
      <div className="p-5">
        {record.isLoading ? (
          <div className="h-4 w-48 animate-pulse rounded bg-[var(--surface-sunken)]" />
        ) : record.isError ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {t('lessonsLearned.loadError', 'Could not load the debrief. Refresh to try again.')}
          </p>
        ) : (
          <DebriefForm
            key={record.data?.updatedAt ?? 'empty'}
            opportunityId={opportunityId}
            outcome={outcome}
            canWrite={canWrite}
            reasonLabel={reasonLabel}
            initial={
              record.data
                ? {
                    reason: record.data.reason,
                    competitor: record.data.competitor ?? '',
                    note: record.data.note ?? '',
                    recordedAt: record.data.updatedAt,
                  }
                : null
            }
            pending={upsert.isPending}
            onSubmit={(body) =>
              upsert.mutate(
                { opportunityId, body: { outcome, ...body } },
                {
                  onSuccess: () =>
                    toast.success(t('lessonsLearned.saved', 'Debrief recorded')),
                  onError: (err: Error) =>
                    toast.error(t('lessonsLearned.saveError', 'Could not record the debrief'), {
                      description: err.message,
                    }),
                },
              )
            }
          />
        )}
      </div>
    </Card>
  );
}

interface DebriefValues {
  reason: WinLossReasonCode;
  competitor: string | null;
  note: string | null;
}

function DebriefForm({
  outcome,
  canWrite,
  reasonLabel,
  initial,
  pending,
  onSubmit,
}: {
  opportunityId: string;
  outcome: WinLossOutcome;
  canWrite: boolean;
  reasonLabel: Record<WinLossReasonCode, string>;
  initial: {
    reason: WinLossReasonCode;
    competitor: string;
    note: string;
    recordedAt: string;
  } | null;
  pending: boolean;
  onSubmit: (body: DebriefValues) => void;
}) {
  const { t } = useTranslation('crm');
  const [reason, setReason] = useState<WinLossReasonCode>(initial?.reason ?? 'price');
  const [competitor, setCompetitor] = useState(initial?.competitor ?? '');
  const [note, setNote] = useState(initial?.note ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      reason,
      competitor: competitor.trim() || null,
      note: note.trim() || null,
    });
  };

  if (!canWrite) {
    return initial ? (
      <dl className="space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="text-[var(--fg-tertiary)]">
            {t('lessonsLearned.reasonLabel', 'Primary factor')}
          </dt>
          <dd className="font-medium text-[var(--fg-primary)]">{reasonLabel[initial.reason]}</dd>
        </div>
        {initial.competitor && (
          <div className="flex gap-2">
            <dt className="text-[var(--fg-tertiary)]">
              {t('lessonsLearned.competitorLabel', 'Competitor')}
            </dt>
            <dd className="text-[var(--fg-secondary)]">{initial.competitor}</dd>
          </div>
        )}
        {initial.note && <p className="text-[var(--fg-secondary)]">{initial.note}</p>}
      </dl>
    ) : (
      <p className="text-xs text-[var(--fg-tertiary)]">
        {t('lessonsLearned.emptyReadOnly', 'No debrief recorded for this bid yet.')}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-[var(--fg-tertiary)]">
        {initial
          ? t('lessonsLearned.recordedOn', 'Last updated {{date}}', {
              date: new Date(initial.recordedAt).toLocaleDateString(),
            })
          : t('lessonsLearned.notYet', 'No debrief recorded yet — capture it while it is fresh.')}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
            {outcome === 'won'
              ? t('lessonsLearned.winFactor', 'Deciding win factor')
              : t('lessonsLearned.lossFactor', 'Deciding loss factor')}
          </span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as WinLossReasonCode)}
            className={inputCls}
            aria-label={t('lessonsLearned.reasonLabel', 'Primary factor')}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {reasonLabel[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
            {t('lessonsLearned.competitorLabel', 'Competitor')}
          </span>
          <input
            value={competitor}
            onChange={(e) => setCompetitor(e.target.value)}
            placeholder={t('lessonsLearned.competitorPlaceholder', 'Who won it (optional)')}
            className={inputCls}
            aria-label={t('lessonsLearned.competitorLabel', 'Competitor')}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
          {t('lessonsLearned.noteLabel', 'Debrief notes')}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={t(
            'lessonsLearned.notePlaceholder',
            'What decided it, what we would repeat, what we would change',
          )}
          className={inputCls}
          aria-label={t('lessonsLearned.noteLabel', 'Debrief notes')}
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending
          ? t('lessonsLearned.saving', 'Saving…')
          : initial
            ? t('lessonsLearned.update', 'Update debrief')
            : t('lessonsLearned.record', 'Record debrief')}
      </Button>
    </form>
  );
}
