// Relay for account activity raised by mail and calendar sync. The bridge in
// @bidstack/db raises one digest per account per sync run
// (runAccountActivityBatch); this hands it to apps/api over the
// account-activity-alerts queue, where followers, channel prefs and
// coalescing are applied. Nothing here messages anyone directly.
import { Queue, type Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { subscribeAccountActivityDigest, type AccountActivityDigest } from '@bidstack/db';
import { ACCOUNT_ACTIVITY_ALERTS, type AccountActivityAlertJob } from '@bidstack/shared';

export function toAccountActivityAlertJob(digest: AccountActivityDigest): AccountActivityAlertJob {
  return {
    orgId: digest.orgId,
    companyId: digest.companyId,
    activityIds: digest.activityIds,
    actorUserId: digest.actorUserId,
    excludeUserIds: digest.excludeUserIds,
  };
}

/** Subscribe the relay; a failed enqueue is logged and never fails the sync. Returns the unsubscribe. */
export function relayAccountActivityDigests(
  add: (job: AccountActivityAlertJob) => Promise<unknown>,
  log: pino.Logger,
): () => void {
  return subscribeAccountActivityDigest(async (digest) => {
    if (digest.activityIds.length === 0) return;
    try {
      await add(toAccountActivityAlertJob(digest));
    } catch (err) {
      log.warn({ err, orgId: digest.orgId, companyId: digest.companyId }, 'could not queue account activity alert');
    }
  });
}

export async function startAccountActivityAlertRelay(
  connection: IORedis,
  log: pino.Logger,
  _workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue<AccountActivityAlertJob>(ACCOUNT_ACTIVITY_ALERTS.name, {
    connection,
    defaultJobOptions: ACCOUNT_ACTIVITY_ALERTS.defaultJobOptions,
  });
  queues.push(queue);
  relayAccountActivityDigests((job) => queue.add('account-activity-alerts.digest', job), log);
  log.info({ queue: ACCOUNT_ACTIVITY_ALERTS.name }, 'account activity alert relay started');
}
