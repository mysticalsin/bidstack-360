// Per-job Redis idempotency claim for calendar push creates.
//
// WHY: the provider POST happens before the DB commit that records externalId.
// If that commit fails (DB blip, pod restart), BullMQ retries the job, re-fetches
// the event (externalId still null) and would POST again — creating a duplicate,
// permanently orphaned event in the user's real calendar. Mirrors the sms.send
// claim-key fix (sms.ts): claim a per-job key BEFORE the POST, record the created
// external id in the claim BEFORE the DB write, and reconcile the lost DB row on
// retry instead of re-creating.

import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';

const CALENDAR_PUSH_CLAIM_TTL_SEC = 86_400; // 24h — well beyond the BullMQ retry/backoff window

interface CreatedClaim {
  id: string;
  etag: string;
}

function pushClaimKey(jobId: string): string {
  return `calendar:push:claim:${jobId}`;
}

/**
 * Claim the per-job push key. Returns true when this attempt owns the create.
 * When a prior attempt already created the provider event, reconciles the lost
 * DB row (externalId/etag) so the event doesn't stay PENDING_PUSH forever, then
 * returns false so the caller skips the POST.
 */
export async function claimCalendarPush(
  connection: IORedis,
  jobId: string,
  eventId: string,
  log: pino.Logger,
): Promise<boolean> {
  const claimKey = pushClaimKey(jobId);
  const claimed = await connection.set(claimKey, 'pending', 'EX', CALENDAR_PUSH_CLAIM_TTL_SEC, 'NX');
  if (claimed === 'OK') return true;

  const prior = await connection.get(claimKey);
  const created =
    prior && prior.startsWith('created:')
      ? (JSON.parse(prior.slice('created:'.length)) as CreatedClaim)
      : null;
  if (created) {
    // Reconcile the DB row the prior attempt failed to commit.
    await prisma.calendarEvent.update({
      where: { id: eventId },
      data: {
        externalId: created.id,
        etag: created.etag,
        syncState: 'SYNCED',
        lastSyncedAt: new Date(),
      },
    });
  }
  log.warn(
    { eventId, externalId: created?.id ?? null },
    'Calendar push skipped — idempotency claim already present (retry after prior create)',
  );
  return false;
}

/** Release the claim after the provider rejected the create so a legitimate retry can re-POST. */
export async function releaseCalendarPushClaim(connection: IORedis, jobId: string): Promise<void> {
  await connection.del(pushClaimKey(jobId));
}

/** Record the created external event BEFORE the DB write so a crash there still blocks a re-create. */
export async function recordCalendarPushClaim(
  connection: IORedis,
  jobId: string,
  created: CreatedClaim,
): Promise<void> {
  await connection.set(
    pushClaimKey(jobId),
    `created:${JSON.stringify(created)}`,
    'EX',
    CALENDAR_PUSH_CLAIM_TTL_SEC,
  );
}
