// RFP section planning — the bridge between story-matching and section drafting.
//
// After ALL story-match jobs for an orchestration complete, exactly one of them
// (claimed atomically) creates the Proposal + its standard sections and fans out
// one section-draft job per section. This is the link that connects requirement
// extraction / story matching to drafting and the late pipeline.
//
// WHY counter-based completion: BullMQ has no native "all children done" signal
// for this fan-out. requirement-extract writes config.story_match_total before
// dispatching; each story-match completion increments config.story_match_done.
// When done >= total, the orchestration is atomically flipped story_match ->
// section_draft (compare-and-swap on current_phase) so exactly one worker plans.
//
// WHY raw SQL for rfp_orchestrations: Wave 9 model not in the generated Prisma
// client. All values parameterized.

import type { Queue } from 'bullmq';
import type pino from 'pino';

import { prisma } from '@bidstack/db';

// Standard proposal section set, in render order.
const STANDARD_SECTIONS: { key: string; title: string }[] = [
  { key: 'executive_summary', title: 'Executive Summary' },
  { key: 'technical_approach', title: 'Technical Approach' },
  { key: 'pricing', title: 'Pricing' },
  { key: 'case_studies', title: 'Case Studies' },
  { key: 'team_bios', title: 'Team & Bios' },
  { key: 'risk_matrix', title: 'Risk Matrix' },
];

interface CounterRow {
  done: number | null;
  total: number | null;
  proposal_id: string | null;
  opportunity_id: string | null;
  document_version_id: string | null;
}

/**
 * Called from the story-match worker's completed handler. Records this
 * completion and, when the whole fan-out is done, plans the proposal sections
 * and dispatches section-draft jobs. Idempotent + race-safe.
 */
export async function advanceToSectionDraftIfReady(
  orgId: string,
  orchestrationId: string,
  sectionDraftQueue: Queue,
  log: pino.Logger,
): Promise<void> {
  // 1. Atomically record this completion and read counters + linkage.
  const rows = await prisma.$queryRaw<CounterRow[]>`
    UPDATE rfp_orchestrations
    SET config = jsonb_set(
          config,
          '{story_match_done}',
          (COALESCE((config->>'story_match_done')::int, 0) + 1)::text::jsonb
        ),
        updated_at = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
    RETURNING
      (config->>'story_match_done')::int AS done,
      (config->>'story_match_total')::int AS total,
      proposal_id::text AS proposal_id,
      opportunity_id::text AS opportunity_id,
      document_version_id::text AS document_version_id
  `;
  const r = rows[0];
  if (!r || r.total == null || r.done == null || r.done < r.total) return;

  // 2. Compare-and-swap the phase so exactly one worker plans this orchestration.
  const claim = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE rfp_orchestrations
    SET current_phase = 'section_draft'::"RfpResponsePhase",
        completed_phases = array_append(completed_phases, 'story_match'::"RfpResponsePhase"),
        updated_at = now()
    WHERE id = ${orchestrationId}::uuid
      AND org_id = ${orgId}::uuid
      AND current_phase = 'story_match'::"RfpResponsePhase"
    RETURNING id::text AS id
  `;
  if (claim.length === 0) return; // another worker already planned this orchestration

  try {
    await planSectionsAndDispatch(
      orgId,
      orchestrationId,
      r.proposal_id,
      r.opportunity_id,
      r.document_version_id,
      sectionDraftQueue,
      log,
    );
  } catch (err) {
    log.error({ err, orchestrationId }, 'rfp-section-planning: failed to plan/dispatch');
    await prisma.$executeRaw`
      UPDATE rfp_orchestrations
      SET state = 'failed',
          failed_phase = 'section_draft'::"RfpResponsePhase",
          failure_reason = ${`section planning: ${(err as Error).message}`.slice(0, 2000)},
          updated_at = now()
      WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
    `;
  }
}

async function planSectionsAndDispatch(
  orgId: string,
  orchestrationId: string,
  existingProposalId: string | null,
  opportunityId: string | null,
  documentVersionId: string | null,
  sectionDraftQueue: Queue,
  log: pino.Logger,
): Promise<void> {
  // Create the proposal (once) and link it to the orchestration.
  let proposalId = existingProposalId;
  if (!proposalId) {
    const proposal = await prisma.proposal.create({
      data: {
        orgId,
        name: 'RFP Proposal',
        status: 'draft',
        ...(opportunityId ? { opportunityId } : {}),
      },
      select: { id: true },
    });
    proposalId = proposal.id;
    await prisma.$executeRaw`
      UPDATE rfp_orchestrations SET proposal_id = ${proposalId}::uuid, updated_at = now()
      WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
    `;
  }

  // Requirement IDs for this run feed story context into each section draft.
  const requirements = documentVersionId
    ? await prisma.requirement.findMany({
        where: { documentVersionId, orgId, deletedAt: null },
        select: { id: true },
      })
    : [];
  const requirementIds = requirements.map((req) => req.id);

  // Create the standard section set (idempotent via the [proposalId, key] unique).
  for (const [index, section] of STANDARD_SECTIONS.entries()) {
    await prisma.proposalSection.upsert({
      where: { proposalId_key: { proposalId, key: section.key } },
      create: {
        orgId,
        proposalId,
        key: section.key,
        title: section.title,
        sortOrder: index,
        required: true,
        aiDrafted: false,
      },
      update: {},
    });
  }

  // Fan out one section-draft job per section.
  const sections = await prisma.proposalSection.findMany({
    where: { proposalId, orgId, deletedAt: null },
    select: { id: true, title: true },
  });
  for (const section of sections) {
    await sectionDraftQueue.add(
      'rfp.section-draft',
      {
        orgId,
        orchestrationId,
        proposalId,
        sectionId: section.id,
        sectionTitle: section.title,
        requirementIds,
      },
      { jobId: `rfp-section-draft-${orchestrationId}-${section.id}` },
    );
  }

  log.info(
    {
      orgId,
      orchestrationId,
      proposalId,
      sectionCount: sections.length,
      requirementCount: requirementIds.length,
    },
    'rfp-section-planning: proposal + sections created, section-draft fan-out dispatched',
  );
}
