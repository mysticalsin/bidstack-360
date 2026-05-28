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

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

import { RFP_STORY_MATCH } from '@bidstack/shared';

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
  const rows = await prisma.$queryRaw<PgVectorRow[]>`
    SELECT
      re.reference_id::text,
      (re.vector <=> ${queryVec}::vector) AS cosine_distance,
      NULL::text                          AS title,
      ARRAY[]::text[]                     AS tags,
      NULL::timestamptz                   AS closed_at
    FROM reference_embeddings re
    WHERE re.org_id = ${orgId}::uuid
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
  // WHY no updated_at: RequirementReferenceMatch has only createdAt and
  // deletedAt — there is no updatedAt column in the schema.
  for (const [idx, m] of topMatches.entries()) {
    const reasoning = `cosine=${m.cosineBps}bps keyword=${m.keywordBps}bps tag=${m.tagBps}bps recency=${m.recencyBps}bps`;
    await prisma.$executeRaw`
      INSERT INTO requirement_reference_matches (
        id, org_id, requirement_id, reference_id,
        score_bps, rank, reasoning, matched_by_agent, agent_run_id,
        created_at
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
        now()
      )
      ON CONFLICT (requirement_id, reference_id)
      DO UPDATE SET
        score_bps         = EXCLUDED.score_bps,
        rank              = EXCLUDED.rank,
        reasoning         = EXCLUDED.reasoning,
        matched_by_agent  = EXCLUDED.matched_by_agent
      WHERE requirement_reference_matches.org_id = ${orgId}::uuid
    `;
  }
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, requirementId, topK } = parsed.data;

  // Verify requirement belongs to this org (uses existing Wave 1 Requirement model)
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId, orgId },
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
  _queues: Queue[],
): Promise<void> {
  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
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
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-story-match: failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-story-match worker started');
}
