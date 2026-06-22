/**
 * Twilio SMS BullMQ worker.
 *
 * Two job types:
 *
 *  sms.send
 *    - Single SMS send. Enqueued by POST /sms/send (rate-limit-safe async path)
 *      and by bulk-send batch fan-out.
 *    - Per-account rate: 1 msg/s by default (Twilio A2P 10DLC).
 *      The queue limiter enforces this.
 *
 *  sms.bulk-send
 *    - Cadence/drip step: takes a list of recipients and fans out to sms.send
 *      jobs to respect the per-account rate limiter automatically.
 *
 * WHY re-implement send here instead of calling apps/api:
 * Cross-app imports create circular build dependencies. The service logic is
 * intentionally duplicated via a thin HTTP client against the Twilio REST API.
 * If this grows, extract to @bidstack/twilio-client package.
 *
 * WHY limiter on the Queue (not Worker): the Queue limiter is shared across
 * all worker instances (it uses Redis), so horizontal scaling doesn't
 * multiply the Twilio request rate.
 */

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { decryptToken } from '@bidstack/shared/token-crypto';

// ─── Queue names ───────────────────────────────────────────────────────────

export const SMS_SEND_QUEUE = 'sms.send';
export const SMS_BULK_SEND_QUEUE = 'sms.bulk-send';

const SMS_CLAIM_TTL_SEC = 86_400; // 24h — well beyond the BullMQ retry/backoff window

// ─── Job data schemas ──────────────────────────────────────────────────────

const SmsSendJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  toNumber: z.string(),
  body: z.string(),
  entityType: z.enum(['CONTACT', 'LEAD']).optional(),
  entityId: z.string().uuid().optional(),
  /** Twilio account SID — resolved at enqueue time so workers don't need DB access for routing */
  integrationTokenId: z.string().uuid(),
});

const SmsBulkSendJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  integrationTokenId: z.string().uuid(),
  recipients: z.array(
    z.object({
      toNumber: z.string(),
      body: z.string(),
      entityType: z.enum(['CONTACT', 'LEAD']).optional(),
      entityId: z.string().uuid().optional(),
    }),
  ),
});

// ─── STOP keywords (CTIA) ─────────────────────────────────────────────────

// ─── Twilio REST helper ────────────────────────────────────────────────────

async function twilioSend(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string,
  log: pino.Logger,
): Promise<{ sid: string; numSegments: number }> {
  log.debug({ to }, 'Sending SMS via Twilio');
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const formBody = new URLSearchParams({
    From: from,
    To: to,
    Body: body,
    StatusCallback: `${process.env.PUBLIC_API_URL ?? ''}/api/v1/integrations/twilio/webhook/status`,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    },
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Twilio ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as { sid: string; num_segments: string };
  return { sid: data.sid, numSegments: parseInt(data.num_segments ?? '1', 10) };
}

// ─── Single-send processor ─────────────────────────────────────────────────

/**
 * Pure builder for an SmsMessage row. Extracted so the send path and the
 * crash-recovery reconcile path produce identical rows without duplication.
 */
export function buildSmsRow(
  data: z.infer<typeof SmsSendJobData>,
  fromNumber: string,
  sid: string,
  numSegments: number,
) {
  return {
    orgId: data.orgId,
    userId: data.userId,
    integrationTokenId: data.integrationTokenId,
    fromNumber,
    toNumber: data.toNumber,
    body: data.body,
    status: 'QUEUED' as const,
    twilioSid: sid,
    segments: numSegments,
    sentAt: new Date(),
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
  };
}

export async function processSingleSend(
  rawData: unknown,
  jobId: string,
  connection: IORedis,
  log: pino.Logger,
): Promise<void> {
  const data = SmsSendJobData.parse(rawData);

  // Consent check — TCPA
  const consent = await prisma.smsConsent.findUnique({
    where: { orgId_phoneNumber: { orgId: data.orgId, phoneNumber: data.toNumber } },
    select: { optedOut: true },
  });
  if (consent?.optedOut) {
    log.warn({ toNumber: data.toNumber }, 'SMS skipped — opted out');
    return;
  }

  // Token fetch/decrypt must precede the claim: the reconcile branch needs
  // fromNumber to rebuild a lost DB row.
  const token = await prisma.integrationToken.findUnique({
    where: { id: data.integrationTokenId },
    select: { accessTokenEncrypted: true, externalAccountId: true },
  });
  if (!token) throw new Error(`IntegrationToken ${data.integrationTokenId} not found`);

  const decrypted = decryptToken(token.accessTokenEncrypted);
  const creds = JSON.parse(decrypted) as { accountSid: string; authToken: string };
  const fromNumber = token.externalAccountId ?? '';

  const claimKey = `sms:claim:${jobId}`;
  // Idempotency: BullMQ retries would re-invoke Twilio after a crash between send
  // and DB commit → duplicate texts. Claim a per-job key BEFORE sending; a prior
  // attempt that already sent will have set it, so we skip the resend.
  const claimed = await connection.set(claimKey, 'pending', 'EX', SMS_CLAIM_TTL_SEC, 'NX');
  if (claimed !== 'OK') {
    const prior = await connection.get(claimKey);
    const priorSid = prior && prior.startsWith('sent:') ? prior.slice('sent:'.length) : null;
    if (priorSid) {
      // Reconcile a lost DB row (twilioSid is @unique → safe to retry).
      await prisma.smsMessage.upsert({
        where: { twilioSid: priorSid },
        update: {},
        create: buildSmsRow(data, fromNumber, priorSid, 1),
      });
    }
    log.warn({ jobId, priorSid }, 'SMS send skipped — idempotency claim already present (retry after prior send)');
    return;
  }

  let sid: string;
  let numSegments: number;
  try {
    ({ sid, numSegments } = await twilioSend(creds.accountSid, creds.authToken, fromNumber, data.toNumber, data.body, log));
  } catch (err) {
    // Twilio never accepted — release the claim so a legitimate retry can resend.
    await connection.del(claimKey);
    throw err;
  }
  // Record the sid in the claim BEFORE the DB write so a crash here still blocks a resend.
  await connection.set(claimKey, `sent:${sid}`, 'EX', SMS_CLAIM_TTL_SEC);

  await prisma.smsMessage.create({ data: buildSmsRow(data, fromNumber, sid, numSegments) });
  log.info({ sid, toNumber: data.toNumber }, 'SMS sent (worker)');
}

// ─── Bulk-send processor ───────────────────────────────────────────────────

async function processBulkSend(
  rawData: unknown,
  smsSendQueue: Queue,
  log: pino.Logger,
): Promise<void> {
  const data = SmsBulkSendJobData.parse(rawData);
  const jobs = data.recipients.map((r, i) => ({
    name: SMS_SEND_QUEUE,
    data: {
      orgId: data.orgId,
      userId: data.userId,
      integrationTokenId: data.integrationTokenId,
      toNumber: r.toNumber,
      body: r.body,
      entityType: r.entityType,
      entityId: r.entityId,
    },
    opts: { delay: i * 1_000 }, // stagger 1 second per message for rate compliance
  }));

  await smsSendQueue.addBulk(jobs);
  log.info({ count: jobs.length }, 'Bulk SMS fan-out enqueued');
}

// ─── Worker startup ────────────────────────────────────────────────────────

export async function startSmsWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: ReturnType<typeof Worker.prototype.constructor extends new (...args: unknown[]) => infer R ? new (...args: unknown[]) => R : never>[],
  queues: Queue[],
): Promise<void> {
  // WHY limiter on the queue: enforces the per-Twilio-account rate across all
  // worker replicas. 1 message/second is conservative for A2P 10DLC.
  const smsSendQueue = new Queue(SMS_SEND_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 100 },
    },
  });

  const smsBulkQueue = new Queue(SMS_BULK_SEND_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });

  const smsSendWorker = new Worker(
    SMS_SEND_QUEUE,
    async (job) => processSingleSend(job.data, String(job.id), connection, log.child({ jobId: job.id })),
    { connection, concurrency: 1, limiter: { max: 1, duration: 1_000 } },
  );

  const smsBulkWorker = new Worker(
    SMS_BULK_SEND_QUEUE,
    async (job) => processBulkSend(job.data, smsSendQueue, log.child({ jobId: job.id })),
    { connection, concurrency: 5 },
  );

  smsSendWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'sms.send job failed');
  });

  smsBulkWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'sms.bulk-send job failed');
  });

  workers.push(smsSendWorker as never);
  workers.push(smsBulkWorker as never);
  queues.push(smsSendQueue);
  queues.push(smsBulkQueue);

  log.info('SMS workers ready (sms.send + sms.bulk-send)');
}
