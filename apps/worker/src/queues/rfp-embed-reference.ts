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

async function cohereEmbed(text: string, log: pino.Logger): Promise<number[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    log.warn('COHERE_API_KEY not set — reference embedding skipped');
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
  // metadata is fetched so the NDA-D gate below can check ndaTier without
  // a second DB round-trip.
  const reference = await prisma.reference.findUnique({
    where: { id: referenceId, orgId, deletedAt: null },
    select: { id: true, metadata: true },
  });
  if (!reference) {
    const err = new Error(
      `rfp-embed-reference: reference ${referenceId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  // §NDA-D gate — GDPR Art. 5(1)(f) / contractual confidentiality obligation.
  // References (success stories) may carry ndaTier='D' in their metadata JSON
  // when sourced from a Tier-D NDA-protected client. Such documents must NEVER
  // be sent to any AI processor, including embedding APIs.
  //
  // WHY doNotRetry: NDA-D status is permanent for a reference.
  // WHY no referenceId in the log: existence of a Tier-D reference must not
  // leak to log aggregators or monitoring dashboards (information-disclosure risk).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- metadata is untyped Json
  const refMeta = reference.metadata as any;
  if (refMeta && refMeta.ndaTier === 'D') {
    const ndaErr = new Error('rfp-embed-reference: reference blocked by NDA-D gate');
    (ndaErr as Error & { doNotRetry?: boolean }).doNotRetry = true;
    log.warn({ orgId }, 'rfp-embed-reference: NDA-D gate blocked embedding — document ID omitted');
    return; // graceful exit — do not embed, do not log document identity
  }

  const contentHash = createHash('sha256').update(contentText, 'utf8').digest('hex');

  // Skip re-embedding when content is unchanged
  const existingHash = await getExistingContentHash(referenceId);
  if (existingHash === contentHash) {
    log.debug({ referenceId }, 'rfp-embed-reference: content unchanged, skipping re-embed');
    return;
  }

  const vector = await cohereEmbed(contentText, log);
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
