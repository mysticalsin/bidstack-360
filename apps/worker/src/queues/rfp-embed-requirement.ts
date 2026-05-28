// RFP requirement embedding worker.
//
// Calls Cohere embed-multilingual-v3 to generate a 1024-dim vector for an
// extracted requirement, then upserts into the requirement_embeddings pgvector
// table. Used downstream by rfp.story-match for cosine similarity search.
//
// WHY $executeRaw for RequirementEmbedding: pgvector `vector(1024)` is an
// Unsupported type in Prisma. Raw SQL is the only path. All values parameterized.
// Wave 9 model also not yet in generated client (Windows DLL lock).

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { createHash } from 'node:crypto';

import { RFP_EMBED_REQUIREMENT } from '@bidstack/shared';

const QUEUE_NAME = RFP_EMBED_REQUIREMENT.name;
const COHERE_MODEL = 'embed-multilingual-v3.0';
const EMBED_DIM = 1024;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  requirementId: z.string().uuid(),
  contentText: z.string().min(1),
});
type JobData = z.infer<typeof JobData>;

// ─── Cohere embedding call ──────────────────────────────────────────────────

interface CohereEmbedResponse {
  embeddings: number[][];
}

async function cohereEmbed(text: string, log: pino.Logger): Promise<number[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    log.warn('COHERE_API_KEY not set — requirement embedding skipped');
    return null;
  }

  const res = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texts: [text.slice(0, 512)],
      model: COHERE_MODEL,
      input_type: 'search_query',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cohere embed failed ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as CohereEmbedResponse;
  const vec = data.embeddings?.[0];
  if (!vec || vec.length !== EMBED_DIM) {
    throw new Error(`Unexpected embedding dimension: ${vec?.length ?? 'missing'}`);
  }
  return vec;
}

// ─── Existing embedding content hash lookup (raw SQL) ─────────────────────

async function getExistingContentHash(requirementId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ content_hash: string }>>`
    SELECT content_hash FROM requirement_embeddings
    WHERE requirement_id = ${requirementId}::uuid
    LIMIT 1
  `;
  return rows[0]?.content_hash ?? null;
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, requirementId, contentText } = parsed.data;

  // Verify requirement belongs to this org using the existing Requirement model
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId, orgId },
    select: { id: true },
  });
  if (!requirement) {
    const err = new Error(
      `rfp-embed-requirement: requirement ${requirementId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const contentHash = createHash('sha256').update(contentText, 'utf8').digest('hex');

  // Skip re-embedding if content hasn't changed
  const existingHash = await getExistingContentHash(requirementId);
  if (existingHash === contentHash) {
    log.debug({ requirementId }, 'rfp-embed-requirement: content unchanged, skipping re-embed');
    return;
  }

  const vector = await cohereEmbed(contentText, log);
  if (!vector) {
    log.warn({ requirementId }, 'rfp-embed-requirement: no vector returned, skipping upsert');
    return;
  }

  // WHY $executeRaw: pgvector HNSW columns use `vector(1024)` — unsupported in
  // Prisma client. All values are parameterized via tagged template literal.
  const pgVec = `[${vector.join(',')}]`;
  await prisma.$executeRaw`
    INSERT INTO requirement_embeddings (
      id, org_id, requirement_id, model, dim, vector, content_hash, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${orgId}::uuid,
      ${requirementId}::uuid,
      ${COHERE_MODEL},
      ${EMBED_DIM},
      ${pgVec}::vector,
      ${contentHash},
      now()
    )
    ON CONFLICT (requirement_id)
    DO UPDATE SET
      vector       = EXCLUDED.vector,
      content_hash = EXCLUDED.content_hash,
      model        = EXCLUDED.model,
      updated_at   = now()
    WHERE requirement_embeddings.org_id = ${orgId}::uuid
  `;

  log.info({ orgId, orchestrationId, requirementId }, 'rfp-embed-requirement: vector upserted');
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpEmbedRequirement(
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
      concurrency: 8,
      limiter: { max: 60, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, requirementId: job.data.requirementId },
      'rfp-embed-requirement: completed',
    );
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-embed-requirement: failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-embed-requirement worker started');
}
