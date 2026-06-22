// Drains sync_events with status='received' and source='dust.webhook' (those
// written by the API's /webhooks/dust receiver) and applies side effects:
//   - document.created / document.updated → upsert Opportunity, CompanyEnrichment, or Note
//   - agent.run.completed → create AiInsight
// Events are marked processed or error with meaningful messages, and audit
// logs are written for significant mutations.

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { DUST_WEBHOOK_PROCESSOR } from '@bidstack/shared';
import {
  upsertOpportunityFromDust,
  upsertCompanyFromDust,
  upsertNoteFromDust,
  upsertLeadFromDust,
} from './dust-sync-helpers.js';

const QUEUE_NAME = DUST_WEBHOOK_PROCESSOR.name;
const TICK_MS = 10_000;

const WebhookPayload = z.record(z.unknown());

/**
 * Thrown inside the agent.run.completed transaction when a concurrent/retried
 * drain has already flipped the event to 'processed'. It rolls the transaction
 * back (un-doing the duplicate insight) and is swallowed as a benign no-op — the
 * event is already in a terminal state, so it must NOT be flipped to 'error'.
 */
class AlreadyProcessedError extends Error {
  constructor() {
    super('sync event already processed by a concurrent drain');
    this.name = 'AlreadyProcessedError';
  }
}

export async function startWebhookProcessor(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: DUST_WEBHOOK_PROCESSOR.defaultJobOptions,
  });
  queues.push(queue);

  await queue.add(
    'drain',
    {},
    {
      repeat: { every: TICK_MS },
      removeOnComplete: { age: 600, count: 50 },
      removeOnFail: { age: 86400 },
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const batch = await prisma.syncEvent.findMany({
        where: { status: 'received', source: 'dust.webhook' },
        orderBy: { receivedAt: 'asc' },
        take: 100,
      });
      if (batch.length === 0) return;
      log.info({ batch: batch.length }, 'processing webhook batch');

      for (const evt of batch) {
        try {
          const payload = WebhookPayload.parse(evt.payload);
          const eventType = String(payload.type ?? evt.eventType);

          if (eventType === 'document.created' || eventType === 'document.updated') {
            const data = WebhookPayload.parse(payload.data ?? {});
            const meta = WebhookPayload.parse(data.metadata ?? {});
            const doc = {
              document_id: String(data.document_id ?? ''),
              text: typeof data.text === 'string' ? data.text : undefined,
              metadata: meta,
            };

            if (!doc.document_id) {
              throw new Error('Missing document_id in webhook payload');
            }

            if (meta.opportunity_code && typeof meta.opportunity_code === 'string') {
              await upsertOpportunityFromDust(evt.orgId, doc);
            } else if (meta.lead_email && typeof meta.lead_email === 'string') {
              await upsertLeadFromDust(evt.orgId, doc);
            } else if (meta.company_name && typeof meta.company_name === 'string') {
              await upsertCompanyFromDust(evt.orgId, doc);
            } else {
              await upsertNoteFromDust(evt.orgId, doc);
            }
          } else if (eventType === 'agent.run.completed') {
            const data = WebhookPayload.parse(payload.data ?? {});
            const output = String(data.output ?? '');
            const runId = String(data.run_id ?? '');

            // Idempotency: the aiInsight + audit + status flip are ONE atomic unit.
            // WHY: without this, a retry after a partial write (insight created,
            // status not yet flipped) re-selects the still-'received' event and
            // double-inserts the insight. The flip is GUARDED on status:'received'
            // (via updateMany count) so the transaction commits exactly once; a
            // second concurrent/retried drain sees count===0 and rolls back, which
            // un-does the duplicate insight. Mark the event handled so the shared
            // post-branch flip below does not run twice.
            await prisma.$transaction(async (tx) => {
              const flipped = await tx.syncEvent.updateMany({
                where: { id: evt.id, orgId: evt.orgId, status: 'received' },
                data: { status: 'processed', processedAt: new Date() },
              });
              if (flipped.count === 0) {
                // Another drain already processed this event — abort so we don't
                // insert a duplicate insight. Throwing rolls back this tx cleanly.
                throw new AlreadyProcessedError();
              }

              const insight = await tx.aiInsight.create({
                data: {
                  orgId: evt.orgId,
                  kind: 'dust.agent_run',
                  title: 'Dust Agent Insight',
                  summary: output.slice(0, 5000),
                  companyName: typeof data.company_name === 'string' ? data.company_name : null,
                  opportunityId:
                    typeof data.opportunity_id === 'string' ? data.opportunity_id : null,
                  sourceAttribution: [
                    { source: 'dust.webhook', eventType, runId, eventId: Number(evt.id) },
                  ] as Prisma.InputJsonValue,
                },
              });

              await tx.auditLog.create({
                data: {
                  orgId: evt.orgId,
                  action: 'ai.insight.created',
                  targetType: 'ai_insight',
                  targetId: insight.id,
                  diff: { source: 'dust.webhook', eventType, runId } as Prisma.InputJsonValue,
                },
              });
            });
            // Status was flipped inside the transaction — skip the shared flip.
            continue;
          } else {
            log.info({ eventType, eventId: evt.id }, 'unhandled dust webhook event type');
          }

          // Document branches + unhandled types: flip status here, GUARDED on the
          // current 'received' status so a retried drain that already flipped is a
          // no-op (count===0) rather than a redundant write.
          await prisma.syncEvent.updateMany({
            where: { id: evt.id, orgId: evt.orgId, status: 'received' },
            data: { status: 'processed', processedAt: new Date() },
          });
        } catch (err) {
          if (err instanceof AlreadyProcessedError) {
            // Benign race — the event already reached a terminal state. Do not
            // overwrite it with 'error'; just move on to the next event.
            log.debug({ eventId: evt.id }, 'sync event already processed — skipping');
            continue;
          }
          const error = err instanceof Error ? err.message : String(err);
          log.warn({ eventId: evt.id, error }, 'webhook event processing failed');
          // Guard on 'received' so we never clobber an event another drain already
          // moved to a terminal state.
          await prisma.syncEvent.updateMany({
            where: { id: evt.id, orgId: evt.orgId, status: 'received' },
            data: {
              status: 'error',
              error,
              processedAt: new Date(),
            },
          });
        }
      }
    },
    { connection },
  );
  workers.push(worker);
}
