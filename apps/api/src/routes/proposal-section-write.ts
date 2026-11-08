/**
 * An AI draft checks proposal status before the model call. Approval can
 * land while that call is in flight. The section write has to take the
 * proposal row and refuse when the status is no longer draft or review,
 * or the approved text is replaced and the approval stays in place.
 */
export type MutableSectionWrite = {
  $queryRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<{ id: string }>>;
  proposalSection: {
    updateMany: (args: {
      where: { id: string; orgId: string; proposalId: string; deletedAt: null };
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
};

export type SectionWriteResult = 'written' | 'immutable' | 'missing';

export async function writeProposalSectionIfMutable(
  tx: MutableSectionWrite,
  input: {
    orgId: string;
    proposalId: string;
    sectionId: string;
    data: Record<string, unknown>;
  },
): Promise<SectionWriteResult> {
  const locked = await tx.$queryRaw`
    SELECT id FROM proposals
    WHERE id = ${input.proposalId}::uuid
      AND org_id = ${input.orgId}::uuid
      AND deleted_at IS NULL
      AND status IN ('draft', 'review')
    FOR UPDATE
  `;
  if (!locked[0]) return 'immutable';
  const changed = await tx.proposalSection.updateMany({
    where: {
      id: input.sectionId,
      orgId: input.orgId,
      proposalId: input.proposalId,
      deletedAt: null,
    },
    data: input.data,
  });
  return changed.count === 1 ? 'written' : 'missing';
}
