import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { useIsAdmin } from '@/lib/auth';
import { api } from '@/lib/api';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { useRfpDraft } from '@/hooks/rfp/useRfpDraft';

/** Review steps that must all be checked before the Approve button is enabled. */
const REVIEW_STEPS = [
  'executiveSummary',
  'requirementsMapping',
  'complianceMatrix',
  'draftSections',
  'legalClearance',
] as const;

type ReviewStep = (typeof REVIEW_STEPS)[number];

interface ApprovePayload {
  reviewNotes: string;
}

export function ApprovalGate() {
  const { t } = useTranslation('rfp');
  const isAdmin = useIsAdmin();
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const stage = useRfpPipelineStore((s) => s.stage);
  const applyEvent = useRfpPipelineStore((s) => s.applyEvent);

  const { query: draftQuery } = useRfpDraft(bidWorkspaceId);
  const proposalId = draftQuery.data?.proposalId ?? null;

  const [checked, setChecked] = useState<Record<ReviewStep, boolean>>(
    () => Object.fromEntries(REVIEW_STEPS.map((s) => [s, false])) as Record<ReviewStep, boolean>,
  );
  const [reviewNotes, setReviewNotes] = useState('');

  const allChecked = REVIEW_STEPS.every((s) => checked[s]);
  const isAwaitingApproval = stage === 'awaiting_approval';

  // WHY: canApprove requires all conditions; UI makes each blocking reason explicit
  const canApprove = isAwaitingApproval && allChecked && isAdmin && !!proposalId;

  const approveMutation = useMutation({
    mutationFn: (payload: ApprovePayload) =>
      api<{ id: string }>(`/api/v1/proposals/${proposalId}/approve`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      applyEvent({
        stage: 'approved',
        message: 'Proposal approved and submitted',
        timestamp: new Date().toISOString(),
        progress: 100,
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : t('approval.errorGeneric');
      applyEvent({
        stage: 'failed',
        message,
        timestamp: new Date().toISOString(),
        error: message,
      });
    },
  });

  const handleApprove = () => {
    if (!canApprove) return;
    approveMutation.mutate({ reviewNotes });
  };

  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{t('approval.title')}</h2>

      {/* Role gate warning */}
      {!isAdmin && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t('approval.requiresAdmin')}
        </div>
      )}

      {/* Stage gate warning */}
      {!isAwaitingApproval && (
        <div
          role="status"
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 text-xs text-[var(--fg-secondary)]"
        >
          {t('approval.waitingForStage')}
        </div>
      )}

      {/* Review checklist */}
      <fieldset>
        <legend className="text-xs font-semibold text-[var(--fg-secondary)]">
          {t('approval.checklist')}
        </legend>
        <div className="mt-2 space-y-2">
          {REVIEW_STEPS.map((step, idx) => {
            // Each checkbox is only enabled after the previous one is checked
            // WHY: idx > 0 guard guarantees REVIEW_STEPS[idx - 1] is in-bounds
            const prevStep = idx > 0 ? REVIEW_STEPS[idx - 1] : undefined;
            const isEnabled = idx === 0 || (prevStep !== undefined && checked[prevStep]);
            return (
              <label
                key={step}
                className={[
                  'flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                  'focus-within:ring-2 focus-within:ring-[var(--brand-primary)] focus-within:ring-offset-1',
                  checked[step]
                    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/20 dark:text-green-200'
                    : isEnabled
                      ? 'border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--fg-primary)] hover:border-[var(--brand-primary)]'
                      : 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--fg-tertiary)] opacity-60',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  checked={checked[step]}
                  disabled={!isEnabled}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [step]: e.target.checked }))}
                  className="h-4 w-4 rounded border-[var(--border-subtle)] focus:ring-[var(--brand-primary)]"
                  aria-label={t(`approval.steps.${step}`)}
                />
                {t(`approval.steps.${step}`)}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Review notes */}
      <div>
        <label
          htmlFor="approval-notes"
          className="text-xs font-semibold text-[var(--fg-secondary)]"
        >
          {t('approval.notesLabel')}
        </label>
        <textarea
          id="approval-notes"
          value={reviewNotes}
          onChange={(e) => setReviewNotes(e.target.value)}
          rows={3}
          placeholder={t('approval.notesPlaceholder')}
          className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-2 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
          aria-label={t('approval.notesLabel')}
        />
      </div>

      {/* Error from mutation */}
      {approveMutation.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {approveMutation.error instanceof Error
            ? approveMutation.error.message
            : t('approval.errorGeneric')}
        </p>
      )}

      {/* Approve button */}
      <button
        type="button"
        disabled={!canApprove || approveMutation.isPending}
        onClick={handleApprove}
        className={[
          'min-h-[44px] w-full rounded-xl px-6 py-3 text-sm font-semibold transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
          canApprove && !approveMutation.isPending
            ? 'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary)]/90 cursor-pointer'
            : 'cursor-not-allowed bg-[var(--surface-sunken)] text-[var(--fg-tertiary)] opacity-60',
        ].join(' ')}
        aria-disabled={!canApprove || approveMutation.isPending}
        title={
          !isAdmin
            ? t('approval.requiresAdmin')
            : !allChecked
              ? t('approval.checklistIncomplete')
              : !isAwaitingApproval
                ? t('approval.waitingForStage')
                : undefined
        }
      >
        {approveMutation.isPending
          ? t('approval.approving')
          : stage === 'approved'
            ? t('approval.approved')
            : t('approval.approve')}
      </button>
    </Card>
  );
}
