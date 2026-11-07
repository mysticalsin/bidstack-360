/**
 * Webhook outbox store.
 *
 * A domain write records its webhook event here, ideally inside the same
 * transaction, so the event exists if and only if the write committed. The
 * worker relay claims due rows, fans them out to the webhook.delivery queue,
 * and marks them dispatched. (orgId, idempotencyKey) is unique: replaying the
 * same logical event (client retry, double submit) records it once.
 *
 * Claiming takes a lease: next_attempt_at moves CLAIM_LEASE_MS ahead, so
 * concurrent relays never claim the same row (SKIP LOCKED) and a relay that
 * crashes mid-batch leaves rows that become due again once the lease expires.
 * A recorded failure replaces the lease with the exponential backoff. A row
 * that spends its attempt budget, by failures or by crashed relays, is
 * dead-lettered (status 'dead', kept for inspection, never claimed again).
 */
import type { Prisma, PrismaClient } from '../generated/client/index.js';

export const WEBHOOK_OUTBOX_MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const CLAIM_LEASE_MS = 60_000;

type Db = PrismaClient | Prisma.TransactionClient;

export type WebhookOutboxRow = {
  id: string;
  orgId: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
  /** Replay rows only: the one subscription to deliver to. */
  subscriptionId?: string | null;
  /** Replay rows only: the message being re-sent. */
  replayOfId?: string | null;
};

/** 'replays' claims only targeted replay rows (domain outbox flag off). */
export type WebhookOutboxClaimMode = 'all' | 'replays';

/** Delay before the next try after failed attempt number `attempt` (1-based). */
export function webhookOutboxBackoffMs(attempt: number): number {
  const exp = BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(exp, MAX_BACKOFF_MS);
}

export async function recordWebhookOutboxEvent(
  db: Db,
  input: {
    orgId: string;
    event: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    subscriptionId?: string;
    replayOfId?: string;
  },
): Promise<{ id: string; duplicate: boolean }> {
  const inserted = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO webhook_outbox (org_id, event, payload, idempotency_key, subscription_id, replay_of_id)
    VALUES (${input.orgId}::uuid, ${input.event}, ${JSON.stringify(input.payload)}::jsonb, ${input.idempotencyKey},
            ${input.subscriptionId ?? null}::uuid, ${input.replayOfId ?? null}::uuid)
    ON CONFLICT (org_id, idempotency_key) DO NOTHING
    RETURNING id`;
  if (inserted[0]) return { id: inserted[0].id, duplicate: false };
  const existing = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM webhook_outbox
     WHERE org_id = ${input.orgId}::uuid AND idempotency_key = ${input.idempotencyKey}`;
  return { id: existing[0]!.id, duplicate: true };
}

export async function claimWebhookOutboxBatch(
  db: Db,
  limit: number,
  mode: WebhookOutboxClaimMode = 'all',
): Promise<WebhookOutboxRow[]> {
  const replaysOnly = mode === 'replays';
  // Rows whose lease expired with the budget spent were held by relays that
  // crashed every time; stop retrying them.
  await db.$executeRaw`
    UPDATE webhook_outbox
       SET status = 'dead', last_error = coalesce(last_error, 'relay lease expired')
     WHERE status = 'pending'
       AND attempts >= ${WEBHOOK_OUTBOX_MAX_ATTEMPTS}
       AND next_attempt_at <= now()
       AND (NOT ${replaysOnly} OR subscription_id IS NOT NULL)`;
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      org_id: string;
      event: string;
      payload: Record<string, unknown>;
      attempts: number;
      created_at: Date;
      subscription_id: string | null;
      replay_of_id: string | null;
    }>
  >`
    WITH due AS (
      SELECT id FROM webhook_outbox
       WHERE status = 'pending'
         AND attempts < ${WEBHOOK_OUTBOX_MAX_ATTEMPTS}
         AND next_attempt_at <= now()
         AND (NOT ${replaysOnly} OR subscription_id IS NOT NULL)
       ORDER BY next_attempt_at
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE webhook_outbox o
       SET attempts = o.attempts + 1,
           next_attempt_at = now() + make_interval(secs => ${CLAIM_LEASE_MS / 1000}::float8)
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.org_id, o.event, o.payload, o.attempts, o.created_at,
              o.subscription_id::text AS subscription_id, o.replay_of_id::text AS replay_of_id`;
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    event: r.event,
    payload: r.payload,
    attempts: r.attempts,
    createdAt: r.created_at,
    subscriptionId: r.subscription_id,
    replayOfId: r.replay_of_id,
  }));
}

export async function markWebhookOutboxDispatched(db: Db, id: string): Promise<void> {
  await db.$executeRaw`
    UPDATE webhook_outbox
       SET status = 'dispatched', dispatched_at = now(), last_error = NULL
     WHERE id = ${id}::uuid AND status = 'pending'`;
}

/** Records a failed relay attempt; dead-letters after the max attempts. */
export async function markWebhookOutboxFailed(
  db: Db,
  id: string,
  error: string,
): Promise<'retry' | 'dead'> {
  const rows = await db.$queryRaw<Array<{ status: string }>>`
    UPDATE webhook_outbox
       SET last_error = ${error.slice(0, 1000)},
           next_attempt_at = now() + make_interval(secs => least(
             ${BASE_BACKOFF_MS / 1000}::float8 * power(2, greatest(attempts - 1, 0)),
             ${MAX_BACKOFF_MS / 1000}::float8)),
           status = CASE WHEN attempts >= ${WEBHOOK_OUTBOX_MAX_ATTEMPTS}
                         THEN 'dead'::webhook_outbox_status ELSE status END
     WHERE id = ${id}::uuid AND status = 'pending'
    RETURNING status::text`;
  return rows[0]?.status === 'dead' ? 'dead' : 'retry';
}
