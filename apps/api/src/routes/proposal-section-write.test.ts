import { describe, expect, it, vi } from 'vitest';

import { writeProposalSectionIfMutable, type MutableSectionWrite } from './proposal-section-write.js';

const orgId = '00000000-0000-4000-8000-000000000001';
const proposalId = '00000000-0000-4000-8000-000000000002';
const sectionId = '00000000-0000-4000-8000-000000000003';

function tx(locked: boolean, count = 1): MutableSectionWrite & {
  $queryRaw: ReturnType<typeof vi.fn>;
  proposalSection: { updateMany: ReturnType<typeof vi.fn> };
} {
  return {
    $queryRaw: vi.fn(async () => (locked ? [{ id: proposalId }] : [])),
    proposalSection: {
      updateMany: vi.fn(async () => ({ count })),
    },
  };
}

describe('AI draft write after approval', () => {
  it('does not write the section when approval has already locked the proposal', async () => {
    // Why: the status check before the model call has already passed.
    // The write itself has to see the approved row, or the approved text changes.
    const db = tx(false);
    const result = await writeProposalSectionIfMutable(db, {
      orgId,
      proposalId,
      sectionId,
      data: { content: 'new draft', wordCount: 2, aiDrafted: true },
    });
    expect(result).toBe('immutable');
    expect(db.proposalSection.updateMany).not.toHaveBeenCalled();
  });

  it('writes only after the proposal row is locked in draft or review', async () => {
    const db = tx(true);
    const data = { content: 'kept draft', wordCount: 2, aiDrafted: true };
    const result = await writeProposalSectionIfMutable(db, {
      orgId,
      proposalId,
      sectionId,
      data,
    });
    expect(result).toBe('written');
    expect(db.$queryRaw).toHaveBeenCalledBefore(db.proposalSection.updateMany);
    expect(db.proposalSection.updateMany).toHaveBeenCalledWith({
      where: { id: sectionId, orgId, proposalId, deletedAt: null },
      data,
    });
  });

  it('does not report a saved draft when the section row is already gone', async () => {
    const db = tx(true, 0);
    const result = await writeProposalSectionIfMutable(db, {
      orgId,
      proposalId,
      sectionId,
      data: { content: 'orphan', wordCount: 1, aiDrafted: true },
    });
    expect(result).toBe('missing');
  });
});
