/**
 * The generic proposal approve route must not stamp `approvedAt` on a
 * proposal that belongs to an RFP orchestration. That stamp makes
 * POST /proposals/:id/rfp-approve reject the row as already approved, so the
 * final-phase check, the open high/critical review check, and the
 * orchestration move to `approved` never run. Compliance autofill stays
 * blocked. Ordinary proposals have no orchestration and keep this route.
 */
export function rfpLinkedApprovalBlock(orchestrationId: string | null | undefined): string | null {
  if (orchestrationId == null || orchestrationId.length === 0) return null;
  return (
    'This proposal is linked to an RFP orchestration. Approve it with ' +
    'POST /api/v1/proposals/:id/rfp-approve so the final review gate runs and the orchestration advances. ' +
    'Approving it here would mark it approved and leave that gate unreachable.'
  );
}
