// RFP reference embedding worker.
//
// Generates a Cohere embed-multilingual-v3 vector for a success story
// (reference document) and upserts it into reference_embeddings.
// Triggered on Reference create/update — background enrichment.
//
// WHY $executeRaw for ReferenceEmbedding: pgvector `vector(1024)` is an
// Unsupported type in Prisma. Raw SQL is the only path. All values parameterized.
// Wave 9 model also not yet in generated client (Windows DLL lock).

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumRetrievalRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';
import { createHash } from 'node:crypto';

import { RFP_EMBED_REFERENCE } from '@bidstack/shared';

const QUEUE_NAME = RFP_EMBED_REFERENCE.name;
const COHERE_MODEL = 'embed-multilingual-v3.0';
const EMBED_DIM = 1024;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  referenceId: z.string().uuid(),
  contentText: z.string().min(1),
});
type JobData = z.infer<typeof JobData>;

// ─── Cohere embedding call ──────────────────────────────────────────────────

interface CohereEmbedResponse {
  embeddings: number[][];
}

function defaultSerumConfigEnvironment(): 'dev' | 'staging' | 'production' {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

async function cohereEmbed(orgId: string, text: string, log: pino.Logger): Promise<number[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    log.warn('COHERE_API_KEY not set — reference embedding skipped');
    return null;
  }

  const decision = await checkSerumRetrievalRuntimePolicy({
    orgId,
    environment: defaultSerumConfigEnvironment(),
    configKey: SERUM_RUNTIME_CONFIG_KEYS.retrieval,
    operation: 'retrieval.embedReference',
    requestedChunks: 1,
    sourceBacked: true,
    expectedConfidence: 1,
  });
  if (!decision.allowed) {
    log.warn(
      { orgId, status: decision.status, reason: decision.reason },
      'SERUM retrieval policy denied reference embedding',
    );
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
      input_type: 'search_document',
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

async function getExistingContentHash(referenceId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ content_hash: string }>>`
    SELECT content_hash FROM reference_embeddings
    WHERE reference_id = ${referenceId}::uuid
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

  const { orgId, referenceId, contentText } = parsed.data;

  // Verify reference belongs to this org — Reference is a Wave 1 model.
  // WHY no metadata select: the Reference model has no metadata column in the
  // current schema. NDA-D classification for references will be handled via a
  // future schema migration adding a confidentialityTier column to Reference.
  const reference = await prisma.reference.findUnique({
    where: { id: referenceId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!reference) {
    const err = new Error(
      `rfp-embed-reference: reference ${referenceId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const contentHash = createHash('sha256').update(contentText, 'utf8').digest('hex');

  // Skip re-embedding when content is unchanged
  const existingHash = await getExistingContentHash(referenceId);
  if (existingHash === contentHash) {
    log.debug({ referenceId }, 'rfp-embed-reference: content unchanged, skipping re-embed');
    return;
  }

  const vector = await cohereEmbed(orgId, contentText, log);
  if (!vector) {
    log.warn({ referenceId }, 'rfp-embed-reference: no vector returned, skipping upsert');
    return;
  }

  // WHY $executeRaw: pgvector `vector(1024)` is unsupported in Prisma client.
  // All values are parameterized — safe against SQL injection.
  const pgVec = `[${vector.join(',')}]`;
  await prisma.$executeRaw`
    INSERT INTO reference_embeddings (
      id, org_id, reference_id, model, dim, vector, content_hash, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${orgId}::uuid,
      ${referenceId}::uuid,
      ${COHERE_MODEL},
      ${EMBED_DIM},
      ${pgVec}::vector,
      ${contentHash},
      now()
    )
    ON CONFLICT (reference_id)
    DO UPDATE SET
      vector       = EXCLUDED.vector,
      content_hash = EXCLUDED.content_hash,
      model        = EXCLUDED.model,
      updated_at   = now()
    WHERE reference_embeddings.org_id = ${orgId}::uuid
  `;

  log.info({ orgId, referenceId }, 'rfp-embed-reference: vector upserted');
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpEmbedReference(
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
      concurrency: 4,
      limiter: { max: 30, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, referenceId: job.data.referenceId },
      'rfp-embed-reference: completed',
    );
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-embed-reference: failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-embed-reference worker started');
}
