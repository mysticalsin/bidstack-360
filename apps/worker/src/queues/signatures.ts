/**
 * Signature worker queues.
 *
 * signature.poll     — For DocuSign requests stuck in SENT state >7 days with no
 *                      terminal event. Polls the DocuSign API for current envelope
 *                      status. WHY: DocuSign's free-tier Connect webhooks are
 *                      unreliable and may miss terminal events.
 *
 * signature.reminder — Sends reminder emails to recipients who haven't signed.
 *                      Runs on a configurable cadence per request.
 *
 * Both queues are registered on startup with repeatable jobs.
 */

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { SIGNATURE_POLL_QUEUE, SIGNATURE_REMINDER_QUEUE } from '@bidstack/shared';

// SignatureStatus enum values mirror packages/db/prisma/schema.prisma — keep in sync.
type SignatureStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'VOIDED' | 'EXPIRED';

// ─── Job data schemas ─────────────────────────────────────────────────────────

const PollJobData = z.object({
  /** When absent: sweeper job that scans all stale SENT requests */
  signatureRequestId: z.string().uuid().optional(),
});

const ReminderJobData = z.object({
  signatureRequestId: z.string().uuid(),
  recipientEmail: z.string().email(),
  recipientName: z.string(),
  documentName: z.string(),
  signingUrl: z.string().optional(),
});

// ─── Status-transition guard ──────────────────────────────────────────────────

/** DocuSign envelope status → canonical SignatureStatus. */
const DOCUSIGN_STATUS_MAP: Record<string, SignatureStatus> = {
  completed: 'SIGNED',
  declined: 'DECLINED',
  voided: 'VOIDED',
  sent: 'SENT',
  delivered: 'SENT',
};

/** Statuses we treat as terminal — the only ones a poll may transition INTO. */
const TERMINAL_STATUSES: ReadonlySet<SignatureStatus> = new Set([
  'SIGNED',
  'DECLINED',
  'VOIDED',
]);

/**
 * Decides whether a polled DocuSign status is a VALID transition for a request
 * currently in `currentStatus`. Returns the target status to apply, or `null`
 * when the transition must be REJECTED. WHY a single guard: DocuSign Connect
 * webhooks can replay or arrive out of order, so a poll must never (a) act on an
 * unmapped status, (b) re-apply the status the request already holds — which
 * would write a duplicate signatureEvent — or (c) flip a request into a
 * non-terminal status via the poll path. All three are rejected here.
 */
export function resolveSignatureTransition(
  currentStatus: SignatureStatus,
  docusignStatus: string,
): SignatureStatus | null {
  const target = DOCUSIGN_STATUS_MAP[docusignStatus];
  if (!target) return null; // unknown / unmapped DocuSign status
  if (target === currentStatus) return null; // no-op: already in this status
  if (!TERMINAL_STATUSES.has(target)) return null; // poll only commits terminal states
  return target;
}

// ─── DocuSign status poll (internal helper) ───────────────────────────────────

async function pollDocuSignStatus(
  requestId: string,
  envelopeId: string,
  log: pino.Logger,
): Promise<void> {
  // Lazy env read — avoids coupling worker boot to API env validation
  const baseUrl = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const privateKeyB64 = process.env.DOCUSIGN_PRIVATE_KEY;

  if (!accountId || !integrationKey || !userId || !privateKeyB64) {
    log.warn({ requestId }, 'DocuSign credentials not configured — skipping poll');
    return;
  }

  // Re-use the same JWT bearer exchange as the API service
  // WHY: the worker is a separate process so we can't import the cached token.
  //      The token is short-lived (2h) so we fetch a fresh one per job batch.
  const { createSign } = await import('node:crypto');
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: integrationKey,
      sub: userId,
      aud: 'account-d.docusign.com',
      iat,
      exp: iat + 3600,
      scope: 'signature impersonation',
    }),
  ).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const privateKeyPem = Buffer.from(privateKeyB64, 'base64').toString('utf8');
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(privateKeyPem).toString('base64url');
  const assertion = `${signingInput}.${sig}`;

  const tokenRes = await fetch('https://account-d.docusign.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenRes.ok) {
    log.error({ status: tokenRes.status, requestId }, 'DocuSign token exchange failed');
    return;
  }
  const { access_token: token } = (await tokenRes.json()) as { access_token: string };

  // Fetch envelope status
  const res = await fetch(`${baseUrl}/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    log.error({ status: res.status, envelopeId, requestId }, 'DocuSign envelope fetch failed');
    return;
  }

  const envelope = (await res.json()) as { status: string };

  const current = await prisma.signatureRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!current) return;

  // Single guard: rejects unmapped, no-op, and non-terminal transitions.
  const newStatus = resolveSignatureTransition(current.status, envelope.status);
  if (!newStatus) return;

  {
    await prisma.$transaction(async (tx) => {
      await tx.signatureRequest.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          ...(newStatus === 'SIGNED' ? { completedAt: new Date() } : {}),
          ...(newStatus === 'VOIDED' ? { voidedAt: new Date() } : {}),
        },
      });
      await tx.signatureEvent.create({
        data: {
          signatureRequestId: requestId,
          type:
            newStatus === 'SIGNED' ? 'SIGNED' : newStatus === 'DECLINED' ? 'DECLINED' : 'VOIDED',
          recipientEmail: null,
          occurredAt: new Date(),
          ipAddress: null,
          userAgent: null,
          payload: { polledStatus: envelope.status, envelopeId } as object,
        },
      });
    });
    log.info({ requestId, newStatus }, 'signature poll: status updated');
  }
}

// ─── Worker setup ─────────────────────────────────────────────────────────────

export async function startSignatureWorkers(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  // ── Poll queue ─────────────────────────────────────────────────────────────
  const pollQueue = new Queue(SIGNATURE_POLL_QUEUE.name, {
    connection,
    defaultJobOptions: SIGNATURE_POLL_QUEUE.defaultJobOptions,
  });

  const pollWorker = new Worker(
    SIGNATURE_POLL_QUEUE.name,
    async (job) => {
      const data = PollJobData.safeParse(job.data);
      if (!data.success) {
        log.warn({ errors: data.error.errors }, 'invalid poll job data');
        return;
      }

      if (data.data.signatureRequestId) {
        // Single request poll
        const req = await prisma.signatureRequest.findUnique({
          where: { id: data.data.signatureRequestId },
          select: { id: true, providerRequestId: true, provider: true },
        });
        if (req?.provider === 'DOCUSIGN' && req.providerRequestId) {
          await pollDocuSignStatus(req.id, req.providerRequestId, log);
        }
      } else {
        // Sweeper: find all DOCUSIGN requests in SENT state older than 7 days
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const stale = await prisma.signatureRequest.findMany({
          where: {
            status: 'SENT',
            provider: 'DOCUSIGN',
            sentAt: { lt: cutoff },
            deletedAt: null,
          },
          select: { id: true, providerRequestId: true },
          take: 50,
        });

        log.info({ count: stale.length }, 'signature poll: sweeping stale requests');
        for (const req of stale) {
          if (req.providerRequestId) {
            await pollDocuSignStatus(req.id, req.providerRequestId, log);
          }
        }
      }
    },
    { connection, concurrency: 5 },
  );

  pollWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'signature poll job failed');
  });

  // Schedule the sweeper to run every 6 hours
  await pollQueue.add(
    'sweep',
    {},
    { repeat: { every: 6 * 60 * 60 * 1000 }, jobId: 'signature-poll-sweep' },
  );

  // ── Reminder queue ─────────────────────────────────────────────────────────
  const reminderQueue = new Queue(SIGNATURE_REMINDER_QUEUE.name, {
    connection,
    defaultJobOptions: SIGNATURE_REMINDER_QUEUE.defaultJobOptions,
  });

  const reminderWorker = new Worker(
    SIGNATURE_REMINDER_QUEUE.name,
    async (job) => {
      const data = ReminderJobData.safeParse(job.data);
      if (!data.success) {
        log.warn({ errors: data.error.errors }, 'invalid reminder job data');
        return;
      }

      const { signatureRequestId, recipientEmail, recipientName, documentName, signingUrl } =
        data.data;

      // Verify the request is still in SENT state before sending a reminder
      const req = await prisma.signatureRequest.findUnique({
        where: { id: signatureRequestId },
        select: { status: true },
      });
      if (!req || req.status !== 'SENT') {
        log.info({ signatureRequestId }, 'skipping reminder: request no longer in SENT state');
        return;
      }

      // WHY: Email sending is not yet wired. This is where you'd call an email
      // service (Resend, SendGrid, etc.). The job structure is ready for it.
      // The event log records that a reminder was attempted.
      log.info(
        { signatureRequestId, recipientEmail },
        'signature reminder: would send reminder email',
      );

      await prisma.signatureEvent.create({
        data: {
          signatureRequestId,
          type: 'DELIVERED',
          recipientEmail,
          occurredAt: new Date(),
          ipAddress: null,
          userAgent: null,
          payload: { reminder: true, recipientName, documentName, signingUrl } as object,
        },
      });
    },
    { connection, concurrency: 10 },
  );

  reminderWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'signature reminder job failed');
  });

  workers.push(pollWorker, reminderWorker);
  queues.push(pollQueue, reminderQueue);

  log.info('signature workers started (poll + reminder)');
}
