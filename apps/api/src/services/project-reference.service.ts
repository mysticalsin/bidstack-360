// Spotlight Ref ingestion — STUB (A5).
//
// TODO(Spotlight Ref): the real consultant -> manager -> pre-sales authoring
// flow lives in Spotlight Ref, which needs an architecture rework before it can
// push validated references here (likely a signed webhook or a poll job). This
// helper is the receiving seam: seeds and tests call it directly today; the
// live ingestion trigger wires into it once Spotlight Ref is reworked. It is
// intentionally NOT exposed as a public create route.
import { prisma } from '@bidstack/db';

export interface IngestProjectReferenceInput {
  orgId: string;
  accountKey: string;
  title: string;
  technicalSummary?: string | null;
  businessSummary?: string | null;
  /** Upstream status; defaults to manager_review (awaiting pre-sales validation). */
  status?: 'draft' | 'manager_review' | 'validated' | 'dispatched';
}

export async function ingestProjectReference(input: IngestProjectReferenceInput): Promise<string> {
  const ref = await prisma.projectReference.create({
    data: {
      orgId: input.orgId,
      accountKey: input.accountKey,
      title: input.title,
      technicalSummary: input.technicalSummary ?? null,
      businessSummary: input.businessSummary ?? null,
      status: input.status ?? 'manager_review',
      sourceSystem: 'spotlight_ref',
    },
    select: { id: true },
  });
  return ref.id;
}
