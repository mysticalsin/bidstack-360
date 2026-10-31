import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';

type ApprovalStatus = 'draft' | 'review' | 'approved' | 'submitted' | 'won' | 'lost';

/**
 * Approval is not proposal writing. The button follows the permission list,
 * not the Admin role. The dev Admin session can draft and must see why it
 * cannot approve.
 */
export function ProposalApprovalActions({
  status,
  canApprove,
  pending,
  error,
  onApprove,
  onSubmit,
}: {
  status: ApprovalStatus;
  canApprove: boolean;
  pending: boolean;
  error: string | null;
  onApprove: (attestation: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation('rfp');
  const [attestation, setAttestation] = useState('');
  const openForApproval = status === 'draft' || status === 'review';

  if (openForApproval && !canApprove) {
    return (
      <p className="text-sm text-[var(--fg-secondary)]">
        {t(
          'proposalApproval.separatePermission',
          'Approval is a separate permission. This session can draft. It cannot approve.',
        )}
      </p>
    );
  }

  if (openForApproval && canApprove) {
    return (
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const text = attestation.trim();
          if (!text) return;
          onApprove(text);
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-[var(--fg-secondary)]">
          {t('proposalApproval.attestationLabel', 'Attestation')}
          <input
            value={attestation}
            onChange={(event) => setAttestation(event.target.value)}
            required
            maxLength={2000}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--fg-primary)]"
          />
        </label>
        <Button type="submit" disabled={pending || attestation.trim().length === 0}>
          {pending
            ? t('proposalApproval.approving', 'Approving…')
            : t('proposalApproval.approve', 'Approve')}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  if (status === 'approved' && canApprove) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" disabled={pending} onClick={onSubmit}>
          {pending
            ? t('proposalApproval.submitting', 'Submitting…')
            : t('proposalApproval.submit', 'Submit this version')}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
