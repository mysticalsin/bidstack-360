import { describe, expect, it } from 'vitest';

import {
  attestationMatchesDecision,
  evidenceFromApprovalDiff,
  visibleProposalStatus,
} from './proposal-approval-evidence.js';

const approver = '11111111-1111-4111-8111-111111111111';
const approvedAt = new Date('2026-11-01T00:00:00.000Z');

describe('proposal approval evidence', () => {
  it('does not treat a rejection sentence as an approval', () => {
    // WHY: the approve routes used to store any non-empty note, including
    // "I reject this", and a later read showed status=approved.
    expect(attestationMatchesDecision('I reject this proposal', 'approve')).toBe(false);
    expect(attestationMatchesDecision('I do not approve these terms', 'approve')).toBe(false);
    expect(attestationMatchesDecision('Approval denied', 'approve')).toBe(false);
    expect(
      visibleProposalStatus(
        { status: 'approved', approvedAt, approvedByUserId: approver },
        { attestation: 'I reject this proposal', decision: 'approve' },
      ),
    ).toBe('review');
  });

  it('does not show an approved row when the attestation or decision is missing', () => {
    // WHY: RFP approval stored status=approved with no attestation. Submit and
    // GET then treated the row as a human decision.
    expect(attestationMatchesDecision(null, 'approve')).toBe(false);
    expect(attestationMatchesDecision('   ', 'approve')).toBe(false);
    expect(attestationMatchesDecision('I approve this proposal', 'reject')).toBe(false);

    const row = { status: 'approved', approvedAt, approvedByUserId: approver };
    expect(visibleProposalStatus(row, null)).toBe('review');
    expect(visibleProposalStatus(row, { attestation: null, decision: 'approve' })).toBe('review');
    expect(
      visibleProposalStatus(row, { attestation: 'I approve this proposal', decision: 'reject' }),
    ).toBe('review');
    expect(
      visibleProposalStatus(
        { status: 'approved', approvedAt: null, approvedByUserId: approver },
        { attestation: 'I approve this proposal', decision: 'approve' },
      ),
    ).toBe('review');
  });

  it('keeps a matching attestation visible as the stored decision', () => {
    // WHY: a real approval still has to read as approved, including the
    // commercial attestation that states the review without the word "reject".
    expect(attestationMatchesDecision('I reviewed the commercial terms.', 'approve')).toBe(true);
    expect(attestationMatchesDecision('I approve this proposal', 'approve')).toBe(true);
    const evidence = { attestation: 'I reviewed the commercial terms.', decision: 'approve' as const };
    expect(
      visibleProposalStatus(
        { status: 'approved', approvedAt, approvedByUserId: approver },
        evidence,
      ),
    ).toBe('approved');
    expect(
      visibleProposalStatus(
        { status: 'submitted', approvedAt, approvedByUserId: approver },
        evidence,
      ),
    ).toBe('submitted');
    expect(visibleProposalStatus({ status: 'draft', approvedAt: null, approvedByUserId: null }, null)).toBe(
      'draft',
    );
  });

  it('reads the attestation from either attestation or notes on the audit diff', () => {
    expect(evidenceFromApprovalDiff({ attestation: 'I approve this proposal', decision: 'approve' })).toEqual({
      attestation: 'I approve this proposal',
      decision: 'approve',
    });
    expect(evidenceFromApprovalDiff({ notes: null })).toEqual({
      attestation: null,
      decision: null,
    });
  });
});
