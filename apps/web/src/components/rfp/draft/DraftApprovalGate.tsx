import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useIsAdmin } from '@/lib/auth';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { useApproveDrafting } from '@/hooks/rfp/useApproveDrafting';

export function DraftApprovalGate() {
  const { t } = useTranslation('rfp');
  const isAdmin = useIsAdmin();
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const orchestrationId = useRfpPipelineStore((s) => s.orchestrationId);
  const stage = useRfpPipelineStore((s) => s.stage);
  const applyEvent = useRfpPipelineStore((s) => s.applyEvent);

  const [reviewed, setReviewed] = useState(false);

  const isAwaitingDraftApproval = stage === 'awaiting_approval';

  const canApprove = isAwaitingDraftApproval && reviewed && isAdmin && !!bidWorkspaceId && !!orchestrationId;

  const approveMutation = useApproveDrafting();

  const handleApprove = () => {
    if (!canApprove) return;
    approveMutation.mutate(
      { workspaceId: bidWorkspaceId!, orchestrationId: orchestrationId! },
      {
        onSuccess: () => {
          applyEvent({
            stage: 'section_drafting',
            message: 'Drafting approved, initiating section drafting...',
            timestamp: new Date().toISOString(),
          });
        },
        onError: (err) => {
          console.error('Draft Approval mutation failed:', err);
        },
      }
    );
  };

  return (
    <Card className="space-y-4 p-4 border-[var(--tag-amber-bg)]">
      <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Human Review: Pre-Drafting Gate</h2>

      <div className="text-sm text-[var(--fg-secondary)]">
        The pipeline has paused before generating the RFP drafts. Please review the extracted requirements and matched stories above to ensure the AI has the correct context before spending tokens on full section drafts.
      </div>

      {!isAdmin && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--tag-amber-bg)] bg-[var(--tag-amber-bg)]/20 p-3 text-xs text-[var(--tag-amber-fg)]"
        >
          {t('approval.requiresAdmin')}
        </div>
      )}

      <fieldset>
        <div className="mt-2 space-y-2">
          <label
            className={[
              'flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
              'focus-within:ring-2 focus-within:ring-[var(--brand-primary)] focus-within:ring-offset-1',
              reviewed
                ? 'border-[var(--tag-jade-bg)] bg-[var(--tag-jade-bg)]/20 text-[var(--tag-jade-fg)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--fg-primary)] hover:border-[var(--brand-primary)]',
            ].join(' ')}
          >
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-subtle)] focus:ring-[var(--brand-primary)]"
            />
            I have reviewed the requirements and story matches, and authorize the AI to begin drafting sections.
          </label>
        </div>
      </fieldset>

      {approveMutation.isError && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {approveMutation.error instanceof Error
            ? approveMutation.error.message
            : t('approval.errorGeneric')}
        </p>
      )}

      <Button
        type="button"
        disabled={!canApprove || approveMutation.isPending}
        onClick={handleApprove}
        variant="primary"
        className="w-full bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)] hover:bg-[var(--tag-amber-bg)]/80 border-none"
      >
        {approveMutation.isPending
          ? 'Approving...'
          : 'Approve & Start AI Drafting'}
      </Button>
    </Card>
  );
}
