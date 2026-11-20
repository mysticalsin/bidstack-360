// RFP story match worker.
//
// For each extracted requirement, runs hybrid retrieval:
//   1. pgvector HNSW cosine similarity search against reference_embeddings
//   2. Keyword overlap rescoring
//   3. Tag overlap rescoring
//   4. Recency decay rescoring
//   5. MMR diversity pruning (Maximal Marginal Relevance)
//
// Writes top-K matches as RequirementReferenceMatch rows.
//
// WHY hybrid over pure vector: cosine alone misses exact phrase matches
// for product names, regulation codes, and acronyms. Keyword + tag overlap
// covers these gaps at negligible compute cost.
//
// Score formula (basis points, 0–10000):
//   final = cosine×0.55 + keyword×0.20 + tag×0.15 + recency×0.10
// Each dimension is [0,10000] before weighting.
//
// WHY $executeRaw for RequirementReferenceMatch: Wave 9 model not in generated
// Prisma client (Windows DLL lock). All values parameterized.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { MemOSService } from '@bidstack/memos';

import { RFP_STORY_MATCH, RFP_SECTION_DRAFT } from '@bidstack/shared';
import { advanceToSectionDraftIfReady } from './rfp-section-planning.js';

const QUEUE_NAME = RFP_STORY_MATCH.name;
const DEFAULT_TOP_K = 5;
const COSINE_WEIGHT = 0.55;
const KEYWORD_WEIGHT = 0.2;
const TAG_WEIGHT = 0.15;
const RECENCY_WEIGHT = 0.1;
const RECENCY_HALF_LIFE_DAYS = 365;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  requirementId: z.string().uuid(),
  topK: z.number().int().min(1).max(20).default(DEFAULT_TOP_K),
});
type JobData = z.infer<typeof JobData>;

// ─── Scoring types ─────────────────────────────────────────────────────────

interface CandidateRow {
  referenceId: string;
  cosineBps: number;
  title?: string | null;
  tags: string[];
  closedAt?: Date | null;
}

export interface ScoredCandidate extends CandidateRow {
  keywordBps: number;
  tagBps: number;
  recencyBps: number;
  finalBps: number;
}

// ─── Keyword overlap scoring ────────────────────────────────────────────────

export function tokenize(text: string): Set<string> {
  // WHY length > 2 (not > 3): bid language is dense with 3-letter acronyms
  // (RFP, SLA, SME, ERP, CRM, SAP, API, KPI) that are the primary differentiators
  // between requirements. Filtering them out degrades keyword signal and causes
  // MMR to collapse stories that differ only by a short client code.
  // length > 2 still drops 1- and 2-character noise (a, an, to, of, etc.).
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

export function keywordOverlapBps(reqText: string, refTitle: string | null | undefined): number {
  if (!refTitle) return 0;
  const reqTokens = tokenize(reqText);
  const refTokens = tokenize(refTitle);
  if (reqTokens.size === 0 || refTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of reqTokens) {
    if (refTokens.has(t)) overlap++;
  }
  // Jaccard similarity scaled to basis points
  const union = new Set([...reqTokens, ...refTokens]).size;
  return Math.round((overlap / union) * 10000);
}

// ─── Tag overlap scoring ────────────────────────────────────────────────────

export function tagOverlapBps(reqText: string, refTags: string[]): number {
  if (refTags.length === 0) return 0;
  const reqLower = reqText.toLowerCase();
  let matches = 0;
  for (const tag of refTags) {
    if (reqLower.includes(tag.toLowerCase())) matches++;
  }
  return Math.round((matches / refTags.length) * 10000);
}

// ─── Recency decay scoring ─────────────────────────────────────────────────

export function recencyBps(closedAt: Date | null | undefined): number {
  if (!closedAt) return 5000; // unknown → neutral
  const ageMs = Date.now() - closedAt.getTime();
  const ageDays = ageMs / 86_400_000;
  // Exponential decay: score = 10000 * exp(-ln2 * ageDays / halfLife)
  // WHY Math.min clamp: a future closedAt (data entry error) produces ageDays < 0
  // which makes exp() return > 1 and the score exceed 10000 before weighting.
  // Clamping keeps the output in [0, 10000] regardless of data quality.
  return Math.min(
    10000,
    Math.round(10000 * Math.exp(-Math.LN2 * (ageDays / RECENCY_HALF_LIFE_DAYS))),
  );
}

// ─── MMR diversity pruning ─────────────────────────────────────────────────
// Removes redundant candidates whose titles are too similar to already-selected ones.

export function mmrPrune(sorted: ScoredCandidate[], topK: number): ScoredCandidate[] {
  const selected: ScoredCandidate[] = [];
  for (const candidate of sorted) {
    if (selected.length >= topK) break;
    const isDuplicate = selected.some((s) => {
      if (!s.title || !candidate.title) return false;
      const overlap = tokenize(s.title);
      const cTokens = tokenize(candidate.title as string);
      let shared = 0;
      for (const t of cTokens) if (overlap.has(t)) shared++;
      const union = new Set([...overlap, ...cTokens]).size;
      const jaccard = union > 0 ? shared / union : 0;
      // WHY 0.8 threshold: near-duplicate titles (same story re-named) should collapse
      return jaccard > 0.8;
    });
    if (!isDuplicate) selected.push(candidate);
  }
  return selected;
}

// ─── pgvector cosine candidate retrieval ───────────────────────────────────

interface PgVectorRow {
  reference_id: string;
  cosine_distance: number;
  title: string | null;
  tags: string[];
  closed_at: Date | null;
}

async function cosineCandidates(
  orgId: string,
  requirementId: string,
  candidateLimit: number,
  log: pino.Logger,
): Promise<CandidateRow[]> {
  // Fetch the requirement embedding vector
  const embRows = await prisma.$queryRaw<Array<{ vector: string }>>`
    SELECT vector::text
    FROM requirement_embeddings
    WHERE requirement_id = ${requirementId}::uuid
      AND org_id = ${orgId}::uuid
    LIMIT 1
  `;

  if (embRows.length === 0) {
    log.warn({ requirementId }, 'rfp-story-match: no embedding found — skipping cosine search');
    return [];
  }

  // embRows[0] is defined — the length check above guarantees it
  const queryVec = embRows[0]!.vector;
  if (!queryVec) {
    log.warn({ requirementId }, 'rfp-story-match: null vector — skipping cosine search');
    return [];
  }

  // HNSW cosine similarity search against reference_embeddings scoped to this org.
  // WHY raw SQL: pgvector <=> operator is unsupported by Prisma client.
  // WHY the JOIN: without the real reference title/tags the keyword + tag +
  // recency rescoring dimensions always saw NULL/empty and contributed ~0,
  // collapsing the hybrid score to cosine-only. Joining the reference row makes
  // all four scoring dimensions live. "references" is double-quoted because it
  // is a reserved word in PostgreSQL; created_at stands in for recency (a
  // reference has no closed date — newer references decay less).
  const rows = await prisma.$queryRaw<PgVectorRow[]>`
    SELECT
      re.reference_id::text,
      (re.vector <=> ${queryVec}::vector) AS cosine_distance,
      r.title                             AS title,
      COALESCE(r.tags, ARRAY[]::text[])   AS tags,
      r.created_at                        AS closed_at
    FROM reference_embeddings re
    JOIN "references" r
      ON r.id = re.reference_id AND r.org_id = re.org_id
    WHERE re.org_id = ${orgId}::uuid
      AND r.deleted_at IS NULL
    ORDER BY re.vector <=> ${queryVec}::vector
    LIMIT ${candidateLimit}
  `;

  return rows.map((r) => ({
    referenceId: r.reference_id,
    // Convert cosine distance [0,2] to basis points [0,10000]
    cosineBps: Math.round((1 - r.cosine_distance / 2) * 10000),
    title: r.title,
    tags: r.tags ?? [],
    closedAt: r.closed_at,
  }));
}

// ─── Persist matches via raw SQL ───────────────────────────────────────────

async function persistMatches(
  orgId: string,
  requirementId: string,
  jobId: string | null,
  topMatches: ScoredCandidate[],
): Promise<void> {
  // WHY $executeRaw per row: RequirementReferenceMatch is a Wave 9 model not
  // yet in the generated Prisma client (Windows DLL lock). ON CONFLICT makes
  // re-runs idempotent — same requirementId+referenceId is a no-op.
  //
  // WHY agent_run_id = NULL: BullMQ job IDs are not UUIDs (format: "123" or
  // "rfp-story-match:orgId:reqId"). The schema defines agent_run_id as
  // @db.Uuid — casting a non-UUID string fails at runtime. NULL is the correct
  // default; a true UUID run ID can be stored once Dust exposes one.
  //
  // WHY (org_id, requirement_id, reference_id) in ON CONFLICT: the unique
  // constraint is defined on all three columns (QA-7: f39f88b4). PostgreSQL
  // requires an exact match to the constraint column list — a 2-col target
  // (requirement_id, reference_id) fails to resolve at runtime.
  for (const [idx, m] of topMatches.entries()) {
    const reasoning = `cosine=${m.cosineBps}bps keyword=${m.keywordBps}bps tag=${m.tagBps}bps recency=${m.recencyBps}bps`;
    await prisma.$executeRaw`
      INSERT INTO requirement_reference_matches (
        id, org_id, requirement_id, reference_id,
        score_bps, rank, reasoning, matched_by_agent, agent_run_id,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${orgId}::uuid,
        ${requirementId}::uuid,
        ${m.referenceId}::uuid,
        ${m.finalBps},
        ${idx + 1},
        ${reasoning},
        'rfp-story-match-hybrid',
        NULL,
        now(),
        now()
      )
      ON CONFLICT (org_id, requirement_id, reference_id)
      DO UPDATE SET
        score_bps         = EXCLUDED.score_bps,
        rank              = EXCLUDED.rank,
        reasoning         = EXCLUDED.reasoning,
        matched_by_agent  = EXCLUDED.matched_by_agent,
        updated_at        = now()
      WHERE requirement_reference_matches.org_id = ${orgId}::uuid
    `;
  }
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger, memos: MemOSService): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, requirementId, topK } = parsed.data;

  // Verify requirement belongs to this org. findFirst (not findUnique) so the
  // orgId is an explicit AND filter rather than relying on Prisma's
  // extended-where-unique default — version-stable cross-tenant scoping.
  const requirement = await prisma.requirement.findFirst({
    where: { id: requirementId, orgId, deletedAt: null },
    select: { id: true, text: true, priority: true },
  });
  if (!requirement) {
    const err = new Error(
      `rfp-story-match: requirement ${requirementId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const reqText = requirement.text;

  // Fetch cosine candidates (2× topK for MMR headroom)
  const candidates = await cosineCandidates(orgId, requirementId, topK * 2, log);

  if (candidates.length === 0) {
    log.info({ orgId, requirementId }, 'rfp-story-match: no candidates found');
    return;
  }

  // Apply hybrid rescoring
  const scored: ScoredCandidate[] = candidates.map((c) => {
    const keywordBps = keywordOverlapBps(reqText, c.title);
    const tagBps = tagOverlapBps(reqText, c.tags ?? []);
    const recencyScore = recencyBps(c.closedAt);
    const finalBps = Math.round(
      c.cosineBps * COSINE_WEIGHT +
        keywordBps * KEYWORD_WEIGHT +
        tagBps * TAG_WEIGHT +
        recencyScore * RECENCY_WEIGHT,
    );
    return { ...c, keywordBps, tagBps, recencyBps: recencyScore, finalBps };
  });

  // Sort descending by final score then apply MMR pruning
  const sorted = scored.sort((a, b) => b.finalBps - a.finalBps);
  const topMatches = mmrPrune(sorted, topK);

  await persistMatches(orgId, requirementId, job.id ?? null, topMatches);

  // Warn when MMR collapses more candidates than expected — signals a near-duplicate-heavy
  // library or a very small story set for this org.
  if (topMatches.length < topK) {
    log.warn(
      {
        orgId,
        requirementId,
        matchCount: topMatches.length,
        topK,
        candidateCount: candidates.length,
      },
      'rfp-story-match: MMR returned fewer matches than topK — library may be sparse or near-duplicate-heavy',
    );
  }

  // L1 MemOS trace — records match results for retrieval quality analysis
  // and win/loss correlation. Non-critical: failure must not fail the match job.
  try {
    await memos.logTrace({
      orgId,
      tier: 'l1',
      module: 'rfp',
      entityType: 'requirement',
      entityId: requirementId,
      action: 'story_match_complete',
      userId: 'system',
      payload: {
        orchestrationId,
        matchCount: topMatches.length,
        topMatchScore: topMatches[0]?.finalBps ?? 0,
        candidateCount: candidates.length,
      },
    });
  } catch (traceErr) {
    log.warn(
      { err: traceErr, requirementId },
      'rfp-story-match: MemOS L1 trace failed — non-critical',
    );
  }

  log.info(
    { orgId, orchestrationId, requirementId, matchCount: topMatches.length },
    'rfp-story-match: complete',
  );
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpStoryMatch(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  // Downstream queue: when the whole story-match fan-out completes, the section-
  // planning bridge creates the proposal + sections and enqueues these drafts.
  const sectionDraftQueue = new BullQueue(RFP_SECTION_DRAFT.name, {
    connection,
    defaultJobOptions: RFP_SECTION_DRAFT.defaultJobOptions,
  });
  queues.push(sectionDraftQueue);

  const memos = new MemOSService();

  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id }), memos),
    {
      connection,
      // WHY concurrency 16: story-match is CPU-bound hybrid scoring; high
      // concurrency amortizes DB round-trips across parallel requirements
      concurrency: 16,
    },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, requirementId: job.data.requirementId },
      'rfp-story-match: completed',
    );
    // When the whole fan-out is done, plan sections + dispatch section drafts.
    void advanceToSectionDraftIfReady(
      job.data.orgId,
      job.data.orchestrationId,
      sectionDraftQueue,
      log,
    );
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-story-match: failed');
    // The section-planning bridge advances the pipeline by counting story-match
    // completions until done >= total. A job that exhausts all retries never
    // reaches the `completed` handler, so without counting it here `done` never
    // catches up to `total` and the whole pipeline freezes at story_match until
    // the 30-min reaper kills it. On the FINAL attempt only (so retries aren't
    // double-counted), record this requirement as done — the pipeline then
    // proceeds with the matches that did succeed instead of stalling.
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return; // more retries pending — don't count yet
    void advanceToSectionDraftIfReady(
      job.data.orgId,
      job.data.orchestrationId,
      sectionDraftQueue,
      log,
    );
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-story-match worker started');
}
