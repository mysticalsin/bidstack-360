/**
 * Native push notification worker.
 *
 * Queue: notification.native-push
 *
 * Job payload: { orgId, userIds?, title, body, data?, badgeCount? }
 *
 * Flow:
 *   1. Look up all active NativePushToken rows for the target users.
 *   2. Chunk tokens into batches of 100 (Expo Push Service limit).
 *   3. Send each batch via Expo's sendPushNotificationsAsync.
 *   4. Handle receipts: mark invalid tokens inactive (expired / not-registered).
 *
 * WHY expo-server-sdk: single SDK handles both APNs and FCM delivery routing
 * through Expo's infrastructure. No separate APNs certificate or FCM server
 * key needed at runtime — signing is done at EAS build time.
 *
 * WHY batch size 100: Expo API limit per request. Sending more will result in
 * 413 responses. See https://docs.expo.dev/push-notifications/sending-notifications/#request-format
 */
import { Queue, Worker } from 'bullmq';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

// ── Constants ────────────────────────────────────────────────────────────────

export const NATIVE_PUSH_QUEUE = 'notification.native-push';

// ── Schemas ──────────────────────────────────────────────────────────────────

const NativePushJobData = z.object({
  orgId: z.string().uuid(),
  /** If omitted, sends to ALL active tokens in the org. */
  userIds: z.array(z.string().uuid()).optional(),
  title: z.string(),
  body: z.string(),
  /** Arbitrary key-value data forwarded to the app's notification handler. */
  data: z.record(z.unknown()).optional(),
  badgeCount: z.number().int().min(0).optional(),
  /** Notification channel for Android (defaults to 'default'). */
  channelId: z.string().optional(),
  /** Deep link to open on tap. Format: bidstack:/<path> */
  deepLink: z.string().optional(),
});

type NativePushJobData = z.infer<typeof NativePushJobData>;

// ── Expo client singleton ────────────────────────────────────────────────────

const expo = new Expo({
  // useFcmV1 is available in expo-server-sdk >= 1.4 and should be set to true
  // for Android once the FCM legacy API is sunset (June 2024).
  useFcmV1: true,
});

// ── Worker ───────────────────────────────────────────────────────────────────

export async function startNativePushWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(NATIVE_PUSH_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 500 },
      removeOnFail: { age: 86_400 },
    },
  });
  queues.push(queue);

  const worker = new Worker<NativePushJobData>(
    NATIVE_PUSH_QUEUE,
    async (job) => {
      const payload = NativePushJobData.parse(job.data);
      const { orgId, userIds, title, body, data, badgeCount, channelId, deepLink } = payload;

      // 1. Fetch active tokens
      const tokens = await prisma.nativePushToken.findMany({
        where: {
          orgId,
          active: true,
          provider: 'EXPO',
          ...(userIds?.length ? { userId: { in: userIds } } : {}),
        },
        select: { id: true, token: true },
      });

      if (!tokens.length) {
        log.debug({ orgId, userIds }, '[native-push] no active tokens, skipping');
        return;
      }

      // 2. Filter to valid Expo push tokens
      const validTokens = tokens.filter(({ token }) => Expo.isExpoPushToken(token));
      const invalidCount = tokens.length - validTokens.length;
      if (invalidCount > 0) {
        log.warn({ invalidCount, orgId }, '[native-push] filtered non-Expo tokens');
      }

      // 3. Build messages
      const messages: ExpoPushMessage[] = validTokens.map(({ token }) => ({
        to: token,
        sound: 'default',
        title,
        body,
        data: {
          ...data,
          ...(deepLink ? { deepLink } : {}),
        },
        badge: badgeCount,
        channelId: channelId ?? 'default',
        priority: 'high',
      }));

      // 4. Send in chunks of EXPO_BATCH_SIZE
      const chunks = expo.chunkPushNotifications(messages);
      const allTickets: ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(chunk);
          allTickets.push(...tickets);
        } catch (err) {
          log.error({ err, orgId }, '[native-push] batch send error');
          throw err; // Let BullMQ retry
        }
      }

      // 5. Handle error tickets — deactivate invalid tokens
      const invalidTokenIds: string[] = [];

      for (let i = 0; i < allTickets.length; i++) {
        const ticket = allTickets[i];
        const tokenRow = validTokens[i];
        if (!ticket) continue;
        if (!tokenRow) continue;

        if (ticket.status === 'error') {
          const errDetails = ticket.details as { error?: string } | undefined;
          const errCode = errDetails?.error;

          if (errCode === 'DeviceNotRegistered' || errCode === 'InvalidCredentials') {
            // WHY deactivate: the token is permanently invalid. Retrying wastes
            // Expo quota and generates noise in the receipt log.
            invalidTokenIds.push(tokenRow.id);
            log.info(
              { tokenId: tokenRow.id, errCode },
              '[native-push] deactivating invalid token',
            );
          } else {
            log.warn(
              { tokenId: tokenRow.id, errCode, ticket },
              '[native-push] non-fatal ticket error',
            );
          }
        }
      }

      if (invalidTokenIds.length) {
        await prisma.nativePushToken.updateMany({
          where: { id: { in: invalidTokenIds } },
          data: { active: false },
        });
      }

      log.info(
        {
          orgId,
          sent: allTickets.length,
          invalidDeactivated: invalidTokenIds.length,
        },
        '[native-push] job complete',
      );
    },
    { connection, concurrency: 5 },
  );

  workers.push(worker);

  log.info(`[native-push] worker started on queue "${NATIVE_PUSH_QUEUE}"`);
}

/**
 * Helper: enqueue a native push notification job.
 * Import this wherever you need to trigger a push (e.g. workflow engine,
 * deal stage change handler, task assignment).
 */
export function enqueueNativePush(
  connection: IORedis,
  data: NativePushJobData,
): Promise<unknown> {
  const queue = new Queue(NATIVE_PUSH_QUEUE, { connection });
  return queue.add('send', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  });
}
