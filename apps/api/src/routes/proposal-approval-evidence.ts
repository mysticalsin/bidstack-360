/**
 * Whether a stored proposal approval is safe to show or act on.
 *
 * status=approved is not itself a decision. The attestation has to match
 * approve, and the approver fields have to be present. A missing attestation,
 * a rejection, or a decision field that says something else is not granted.
 */

const REJECTION = /\b(?:reject(?:ed|ion)?|denied?)\b/i;
const NEGATED_APPROVAL = /\b(?:do not|don't|dont|cannot|can't|cant|not)\s+approv/i;

export type ProposalApprovalEvidence = {
  attestation: string | null;
  decision: string | null;
};

export function attestationMatchesDecision(
  attestation: string | null | undefined,
  decision: string | null | undefined,
): boolean {
  if (decision !== 'approve' && decision !== 'reject') return false;
  if (typeof attestation !== 'string') return false;
  const text = attestation.trim();
  if (!text) return false;
  const rejects = REJECTION.test(text);
  const negated = NEGATED_APPROVAL.test(text);
  if (decision === 'approve') return !rejects && !negated;
  return rejects && !negated && !/\bapprov/i.test(text);
}

export function evidenceFromApprovalDiff(diff: unknown): ProposalApprovalEvidence {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) {
    return { attestation: null, decision: null };
  }
  const record = diff as Record<string, unknown>;
  const attestation =
    typeof record.attestation === 'string'
      ? record.attestation
      : typeof record.notes === 'string'
        ? record.notes
        : null;
  const decision = typeof record.decision === 'string' ? record.decision : null;
  return { attestation, decision };
}

const APPROVAL_CLAIM = new Set(['approved', 'submitted', 'won']);

/**
 * A later read must not repeat a decision word when the row's evidence
 * disagrees with it. Draft and review pass through. Lost is not an approval.
 */
export function visibleProposalStatus(
  row: {
    status: string;
    approvedAt: Date | null;
    approvedByUserId: string | null;
  },
  evidence: ProposalApprovalEvidence | null,
): string {
  if (!APPROVAL_CLAIM.has(row.status)) return row.status;
  if (!row.approvedAt || !row.approvedByUserId || !evidence) return 'review';
  if (evidence.decision != null && evidence.decision !== 'approve') return 'review';
  const granted = attestationMatchesDecision(evidence.attestation, 'approve');
  return granted ? row.status : 'review';
}
