/**
 * rfp-requirement-extract.processor.ts — core processJob function.
 *
 * Extracted from rfp-requirement-extract.ts (BS-R1 file-size refactor).
 */
import type { Queue, Job } from 'bullmq';
import type pino from 'pino';
import type { z } from 'zod';

import type { MemOSService } from '@bidstack/memos';
import { prisma } from '@bidstack/db';
import { RFP_STORY_MATCH, rolePreambleForKey } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { logAiInvocation } from '../lib/ai-audit-worker.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';

import {
  JobData,
  type ExtractedRequirement,
  DustExtractionResponse,
  fallbackExtract,
  ensureExtractedText,
  updateOrchestrationPhase,
  markOrchestrationFailed,
  isDocumentAiSafe,
} from './rfp-requirement-extract.helpers.js';

const DEFAULT_EXTRACT_AGENT_ID = 'rfp-extractor-agent';

// ─── Core processor ────────────────────────────────────────────────────────

export async function processJob(
  job: Job<JobData>,
  log: pino.Logger,
  embedQueue: Queue,
  storyMatchQueue: Queue,
  memos: MemOSService,
): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, documentVersionId, orchestrationId, chunkIndex, totalChunks } = parsed.data;

  // Ensure the source text exists — parse the uploaded file on first run, then
  // reuse it on retries. WHY here: requirement-extract is the sole consumer of
  // extractedText and owns the retry/backoff, so extraction belongs at its
  // doorstep rather than in the concurrency-1 orchestrator. See ensureExtractedText.
  const rawText = await ensureExtractedText(documentVersionId, orgId, log);

  // §NDA-D gate — must pass before any AI call.
  // WHY orchestrationId in log (not documentVersionId): orchestrationId is already
  // public context for monitoring; documentVersionId must not appear on a blocked-D record.
  const aiSafe = await isDocumentAiSafe(documentVersionId, orgId);
  if (!aiSafe) {
    const ndaErr = new Error('rfp-requirement-extract: document blocked by NDA-D gate');
    (ndaErr as Error & { doNotRetry?: boolean }).doNotRetry = true;
    log.warn(
      { orchestrationId },
      'rfp-requirement-extract: NDA-D gate blocked AI call — document ID omitted',
    );
    await markOrchestrationFailed(orchestrationId, orgId, 'requirement_extract', 'NDA-D gate');
    return; // graceful exit — no AI call, no requirement extraction
  }

  const { client: dust, creds } = await getOrgDust(orgId, log);
  const extractAgentId =
    resolveAgentId(creds, 'requirementExtract', process.env.DUST_RFP_EXTRACTOR_AGENT_ID) ??
    DEFAULT_EXTRACT_AGENT_ID;

  let requirements: Array<z.infer<typeof ExtractedRequirement>>;
  let dustRunId: string | null = null;

  // ─── Call Dust rfp-extractor-agent ───────────────────────────────────
  if (dust) {
    const userMessage = buildAgentUserMessage({
      template:
        `${rolePreambleForKey('requirements_analyst')}\n\n` +
        'Extract all requirements from the following RFP document chunk ' +
        '(chunk {{CHUNK_INDEX}} of {{TOTAL_CHUNKS}}). ' +
        'Return ONLY a JSON object with a "requirements" array. Each item must have: ' +
        'externalRef (string), text (string), requirementType (string), mandatory (boolean), ' +
        'priority (low|medium|high|critical), confidenceBps (0-10000), sourceChunkIndex (integer).',
      trusted: { CHUNK_INDEX: chunkIndex + 1, TOTAL_CHUNKS: totalChunks },
      rfpContent: rawText,
    });

    const t0 = Date.now();
    try {
      const run = await dust.runAgent(extractAgentId, userMessage);
      dustRunId = run.run_id;
      const durationMs = Date.now() - t0;
      const responseText = run.output ?? '{}';

      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-extractor',
          model: 'dust',
          prompt: userMessage,
          response: responseText,
          tokenCount: 0,
          durationMs,
          status: 'success',
          traceId: job.id ?? undefined,
        },
        log,
      );

      const p2 = DustExtractionResponse.safeParse(JSON.parse(responseText));
      requirements = p2.success ? p2.data.requirements : fallbackExtract(rawText);
    } catch (dustErr) {
      log.warn({ err: dustErr }, 'rfp-requirement-extract: Dust call failed, falling back');
      requirements = fallbackExtract(rawText);
      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-extractor',
          model: 'dust',
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (dustErr as Error).message?.slice(0, 500),
          traceId: job.id ?? undefined,
        },
        log,
      );
    }
  } else {
    requirements = fallbackExtract(rawText);
  }

  if (requirements.length === 0) {
    log.info({ orgId, orchestrationId }, 'rfp-requirement-extract: no requirements found');
    // WHY fail (not advance to story_match): with zero requirements there are no
    // story-match jobs to enqueue and story_match_total is never written, so the
    // section-planning bridge can never fire — the pipeline would freeze at
    // story_match until the 30-min reaper. Fail loud with an actionable reason so
    // the user knows immediately the document yielded no requirements.
    await markOrchestrationFailed(
      orchestrationId,
      orgId,
      'requirement_extract',
      'No requirements could be extracted from this document. It may be empty, image-only, or not a structured RFP.',
    );
    try {
      await memos.logTrace({
        orgId,
        tier: 'l1',
        module: 'rfp',
        entityType: 'document_version',
        entityId: documentVersionId,
        action: 'requirements_extracted',
        userId: 'system',
        payload: { orchestrationId, requirementCount: 0, dustRunId },
      });
    } catch (traceErr) {
      log.warn({ err: traceErr }, 'rfp-requirement-extract: MemOS L1 trace failed — non-critical');
    }
    return;
  }

  // ─── Persist requirements via existing Requirement model ───────────────
  // WHY createMany with skipDuplicates: re-runs are idempotent;
  // externalRef+documentVersionId is a natural dedup key.
  // orchestrationId stored in metadata JSON since the Requirement model
  // predates Wave 9 and has no orchestrationId column.
  await prisma.requirement.createMany({
    data: requirements.map((r) => ({
      orgId,
      documentVersionId,
      externalRef: r.externalRef,
      text: r.text,
      requirementType: r.requirementType,
      mandatory: r.mandatory,
      priority: r.priority as 'low' | 'medium' | 'high' | 'critical',
      confidenceBps: r.confidenceBps,
      metadata: { orchestrationId, sourceChunkIndex: r.sourceChunkIndex, dustRunId },
    })),
    skipDuplicates: true,
  });

  // ─── Fan-out: 3 jobs per extracted requirement ────────────────────────
  // WHY 3 jobs: (1) embed-requirement generates the pgvector embedding for
  // cosine search; (2) story-match runs hybrid retrieval against reference
  // embeddings; (3) embed-reference is not triggered here — it fires on
  // SuccessStory create/update events — but story-match IS triggered here
  // because it depends on requirement embeddings being present (the embed
  // job runs first and is idempotent on re-runs).
  //
  // WHY story-match jobId includes requirementId: deduplication ensures
  // a re-run of the extraction phase does not double-schedule matches for
  // requirements that already have embeddings.
  const savedRequirements = await prisma.requirement.findMany({
    where: { documentVersionId, orgId, deletedAt: null },
    select: { id: true, text: true },
  });

  // Record the story-match fan-out size so the story-match completion handler
  // knows when the whole fan-out is done (the section-planning bridge).
  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET config = jsonb_set(
          jsonb_set(config, '{story_match_total}', ${savedRequirements.length}::text::jsonb),
          '{story_match_done}', '0'::jsonb
        ),
        updated_at = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
  `;

  for (const req of savedRequirements) {
    // 1. Embed this requirement's text into requirement_embeddings
    await embedQueue.add(
      'rfp.embed-requirement',
      {
        orgId,
        orchestrationId,
        requirementId: req.id,
        contentText: req.text,
      },
      { jobId: `rfp-embed-req-${orgId}-${req.id}` },
    );

    // 2. Run hybrid story-match for this requirement
    // WHY no waitChildren: story-match has its own retry/backoff; it will
    // fail with a missing embedding and retry after embed completes.
    await storyMatchQueue.add(
      'rfp.story-match',
      {
        orgId,
        orchestrationId,
        requirementId: req.id,
      },
      {
        jobId: `rfp-story-match-${orgId}-${req.id}`,
        attempts: RFP_STORY_MATCH.defaultJobOptions.attempts,
        backoff: RFP_STORY_MATCH.defaultJobOptions.backoff,
      },
    );
  }

  // RfpResponsePhase enum: 'requirement_extract' = this phase, 'story_match' = next
  await updateOrchestrationPhase(orchestrationId, orgId, 'story_match', 'requirement_extract');

  // L1 MemOS trace — records extraction run for downstream quality analysis.
  // Non-critical: failure must not fail the extraction job.
  try {
    await memos.logTrace({
      orgId,
      tier: 'l1',
      module: 'rfp',
      entityType: 'document_version',
      entityId: documentVersionId,
      action: 'requirements_extracted',
      userId: 'system',
      payload: {
        orchestrationId,
        requirementCount: savedRequirements.length,
        dustRunId,
      },
    });
  } catch (traceErr) {
    log.warn({ err: traceErr }, 'rfp-requirement-extract: MemOS L1 trace failed — non-critical');
  }

  log.info(
    { orgId, orchestrationId, count: savedRequirements.length },
    'rfp-requirement-extract: complete',
  );
}
