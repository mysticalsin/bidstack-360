// RFP section draft worker.
//
// Calls Dust rfp-draft-agent to generate a proposal section draft.
// Injects matched success story context for the section's requirements.
// Writes the draft to ProposalSection.content with aiDrafted = true.
//
// WHY per-section: proposal sections are independent; parallel drafting
// reduces end-to-end pipeline time. Section ordering is handled by the
// proposal rendering layer, not here.
//
// WHY raw SQL for RequirementReferenceMatch: Wave 9 model not in generated
// Prisma client (Windows DLL lock). All values parameterized.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';
import { MemOSService } from '@bidstack/memos';

import { RFP_SECTION_DRAFT, RFP_LEGAL_SCAN } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { logAiInvocation } from '../lib/ai-audit-worker.js';
import { updateOrchestrationPhase } from './rfp-requirement-extract.helpers.js';

const QUEUE_NAME = RFP_SECTION_DRAFT.name;
const DUST_AGENT_ID = process.env.DUST_RFP_DRAFT_AGENT_ID ?? 'rfp-draft-agent';
const MAX_STORY_CONTEXT_CHARS = 4000;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  sectionId: z.string().uuid(),
  sectionTitle: z.string().min(1),
  requirementIds: z.array(z.string().uuid()).min(0),
});
type JobData = z.infer<typeof JobData>;

// ─── Dust client (fail-open) ────────────────────────────────────────────────

function getDustClient(log: pino.Logger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    log.warn('DUST_API_KEY or DUST_WORKSPACE_ID not set — section draft degraded to placeholder');
    return null;
  }
  return new DustClient({ apiKey, workspaceId, logger: log });
}

// ─── Story context builder ─────────────────────────────────────────────────

interface StoryContext {
  requirementText: string;
  referenceId: string;
  scoreBps: number;
  reasoning: string;
}

interface MatchRow {
  requirement_id: string;
  reference_id: string;
  score_bps: number;
  reasoning: string | null;
  requirement_text: string;
}

async function buildStoryContext(orgId: string, requirementIds: string[]): Promise<StoryContext[]> {
  if (requirementIds.length === 0) return [];

  // WHY raw SQL: RequirementReferenceMatch is a Wave 9 model not in the
  // generated Prisma client. Join with Requirement to fetch text in one query.
  const matches = await prisma.$queryRaw<MatchRow[]>`
    SELECT
      rrm.requirement_id::text,
      rrm.reference_id::text,
      rrm.score_bps,
      rrm.reasoning,
      r.text AS requirement_text
    FROM requirement_reference_matches rrm
    JOIN requirements r ON r.id = rrm.requirement_id
    WHERE rrm.org_id = ${orgId}::uuid
      AND rrm.requirement_id = ANY(${requirementIds}::uuid[])
      AND rrm.rank <= 3
    ORDER BY rrm.requirement_id, rrm.rank
  `;

  return matches.map((m) => ({
    requirementText: m.requirement_text,
    referenceId: m.reference_id,
    scoreBps: m.score_bps,
    reasoning: m.reasoning ?? '',
  }));
}

function formatStoryContext(contexts: StoryContext[]): string {
  if (contexts.length === 0) return 'No matched success stories available for this section.';
  const lines = contexts.map(
    (c, i) =>
      `Story ${i + 1} (score=${c.scoreBps}bps): [Ref ${c.referenceId}]\n` +
      `Requirement: ${c.requirementText.slice(0, 200)}\n` +
      `Match rationale: ${c.reasoning.slice(0, 200)}`,
  );
  return lines.join('\n\n').slice(0, MAX_STORY_CONTEXT_CHARS);
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger, memos: MemOSService): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, proposalId, sectionId, sectionTitle, requirementIds } =
    parsed.data;

  // Verify proposal belongs to this org
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId, orgId },
    select: { id: true },
  });
  if (!proposal) {
    const err = new Error(`rfp-section-draft: proposal ${proposalId} not found for org ${orgId}`);
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const storyContexts = await buildStoryContext(orgId, requirementIds);
  const storyContextText = formatStoryContext(storyContexts);

  const dust = getDustClient(log);
  let draftContent: string;

  if (dust) {
    const userMessage = buildAgentUserMessage({
      template:
        'Write a professional proposal section titled "{{SECTION_TITLE}}" for proposal {{PROPOSAL_ID}}. ' +
        'Use the matched success story context below to ground claims in real delivery evidence. ' +
        'Output only the section content in Markdown. Do not include a heading — it will be added by the renderer.',
      trusted: { SECTION_TITLE: sectionTitle, PROPOSAL_ID: proposalId },
      userText: storyContextText,
    });

    const t0 = Date.now();
    try {
      const run = await dust.runAgent(DUST_AGENT_ID, userMessage);
      draftContent = run.output ?? `[Draft pending for: ${sectionTitle}]`;

      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-draft',
          // DustAgentRun does not expose model or tokenCount — use fixed values
          model: 'dust',
          prompt: userMessage,
          response: draftContent,
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'success',
          traceId: job.id ?? undefined,
        },
        log,
      );
    } catch (err) {
      log.warn({ err, sectionId }, 'rfp-section-draft: Dust call failed, using placeholder');
      draftContent = `[Draft generation failed for: ${sectionTitle}. Please complete manually.]`;
      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-draft',
          model: 'dust',
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (err as Error).message?.slice(0, 500),
          traceId: job.id ?? undefined,
        },
        log,
      );
    }
  } else {
    draftContent = `[Draft pending for: ${sectionTitle}. Configure DUST_API_KEY to enable AI drafting.]`;
  }

  // Write draft to ProposalSection — content field holds draft text, aiDrafted
  // flags that this was machine-generated. ProposalSection has no dustRunId,
  // status, or draftedAt columns — those are Wave 9 fields tracked via orchestration.
  await prisma.proposalSection.updateMany({
    where: { id: sectionId, orgId, proposalId },
    data: {
      content: draftContent,
      aiDrafted: true,
    },
  });

  // L1 MemOS trace — records every agent run for memory retrieval and quality
  // analysis. Non-critical: a MemOS write failure must not fail the draft job.
  try {
    await memos.logTrace({
      orgId,
      tier: 'l1',
      module: 'rfp',
      entityType: 'proposal_section',
      entityId: sectionId,
      action: 'draft_complete',
      userId: 'system',
      payload: {
        orchestrationId,
        proposalId,
        sectionTitle,
        storyCount: storyContexts.length,
        draftLength: draftContent.length,
      },
    });
  } catch (traceErr) {
    log.warn(
      { err: traceErr, sectionId },
      'rfp-section-draft: MemOS L1 trace failed — non-critical',
    );
  }

  log.info({ orgId, orchestrationId, sectionId }, 'rfp-section-draft: complete');
}

// ─── Fan-out completion → legal-scan trigger ────────────────────────────────
// BullMQ has no native "all children done" signal for this fan-out, so we
// detect completion statelessly: once every ProposalSection for the proposal is
// aiDrafted, advance the orchestration to legal_scan and enqueue it. The
// deterministic legal-scan jobId dedups the race when the final section jobs
// finish near-simultaneously (only one legal-scan job is ever created).
async function maybeAdvanceToLegalScan(
  job: Job<JobData>,
  log: pino.Logger,
  legalScanQueue: BullQueue,
): Promise<void> {
  const { orgId, orchestrationId, proposalId } = job.data;
  try {
    const [total, drafted] = await Promise.all([
      prisma.proposalSection.count({ where: { proposalId, orgId, deletedAt: null } }),
      prisma.proposalSection.count({
        where: { proposalId, orgId, deletedAt: null, aiDrafted: true },
      }),
    ]);
    if (total === 0 || drafted < total) return;

    // documentVersionId lives on the orchestration row (Wave 9 — raw SQL).
    const rows = await prisma.$queryRaw<{ document_version_id: string }[]>`
      SELECT document_version_id::text AS document_version_id
      FROM rfp_orchestrations
      WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
    `;
    const documentVersionId = rows[0]?.document_version_id;
    if (!documentVersionId) {
      log.warn({ orchestrationId }, 'rfp-section-draft: orchestration not found — cannot advance');
      return;
    }

    await updateOrchestrationPhase(orchestrationId, orgId, 'legal_scan', 'section_draft');
    await legalScanQueue.add(
      'rfp.legal-scan',
      { orgId, orchestrationId, documentVersionId, proposalId },
      { jobId: `rfp-legal-scan-${orchestrationId}` },
    );
    log.info({ orchestrationId }, 'rfp-section-draft: all sections drafted -> legal-scan enqueued');
  } catch (err) {
    log.error({ err, orchestrationId }, 'rfp-section-draft: legal-scan trigger failed');
  }
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpSectionDraft(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  // Downstream queue: when all section drafts finish, the completed handler
  // advances the orchestration to legal_scan and enqueues this.
  const legalScanQueue = new BullQueue(RFP_LEGAL_SCAN.name, {
    connection,
    defaultJobOptions: RFP_LEGAL_SCAN.defaultJobOptions,
  });
  queues.push(legalScanQueue);

  // WHY module-scoped singleton: MemOSService is stateless (uses the shared
  // Prisma client internally); creating one instance per worker bootstrap avoids
  // per-job allocation while keeping the reference out of the global scope.
  const memos = new MemOSService();

  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id }), memos),
    {
      connection,
      // WHY concurrency 4: section drafts are long Dust calls (tokens-heavy);
      // cap to avoid saturating the Dust API token budget
      concurrency: 4,
      limiter: { max: 8, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, sectionId: job.data.sectionId }, 'rfp-section-draft: completed');
    // After each section draft, check whether the whole fan-out is done; if so,
    // advance the orchestration to legal_scan and kick off the late pipeline.
    void maybeAdvanceToLegalScan(job, log, legalScanQueue);
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-section-draft: failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-section-draft worker started');
}
