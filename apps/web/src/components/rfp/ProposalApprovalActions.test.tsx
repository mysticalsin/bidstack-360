import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProposalApprovalActions } from './ProposalApprovalActions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe('ProposalApprovalActions', () => {
  it('does not offer approve to a writer who lacks the approval permission', () => {
    // Why: the dev Admin can draft. Treating Admin as the approver would
    // let Dust read a decision this session is not allowed to make.
    render(
      <ProposalApprovalActions
        status="review"
        canApprove={false}
        pending={false}
        error={null}
        onApprove={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/cannot approve/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('asks an approver for an attestation before the proposal can be approved', () => {
    render(
      <ProposalApprovalActions
        status="review"
        canApprove
        pending={false}
        error={null}
        onApprove={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByLabelText('Attestation')).toBeTruthy();
  });
});
