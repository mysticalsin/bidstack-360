// activities_ingest writes through @bidstack/db ingestActivities in this
// process, which raises one account activity digest per account per call.
// This hands each digest to apps/api over the account-activity-alerts queue,
// where followers, channel prefs and coalescing are applied. Nothing here
// messages anyone directly.
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { subscribeAccountActivityDigest } from '@bidstack/db';
import { ACCOUNT_ACTIVITY_ALERTS, type AccountActivityAlertJob } from '@bidstack/shared';

type Log = { warn: (obj: object, msg: string) => void };

/** Subscribe the relay; a failed enqueue is logged and never fails the tool call. Returns the unsubscribe. */
export function relayAccountActivityDigests(
  add: (job: AccountActivityAlertJob) => Promise<unknown>,
  log: Log,
): () => void {
  return subscribeAccountActivityDigest(async (digest) => {
    if (digest.activityIds.length === 0) return;
    try {
      await add({
        orgId: digest.orgId,
        companyId: digest.companyId,
        activityIds: digest.activityIds,
        actorUserId: digest.actorUserId,
        excludeUserIds: digest.excludeUserIds,
      });
    } catch (err) {
      log.warn({ err, orgId: digest.orgId, companyId: digest.companyId }, 'could not queue account activity alert');
    }
  });
}

/** Start the relay; returns a stop function for shutdown. */
export function startAccountActivityAlertRelay(log: Log): () => Promise<void> {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
  });
  connection.on('error', (err) => log.warn({ err }, 'Redis connection error in account-activity-alerts relay'));
  const queue = new Queue<AccountActivityAlertJob>(ACCOUNT_ACTIVITY_ALERTS.name, {
    connection,
    defaultJobOptions: ACCOUNT_ACTIVITY_ALERTS.defaultJobOptions,
  });
  const off = relayAccountActivityDigests((job) => queue.add('account-activity-alerts.digest', job), log);
  return async () => {
    off();
    await queue.close().catch(() => undefined);
    await connection.quit().catch(() => connection.disconnect());
  };
}
