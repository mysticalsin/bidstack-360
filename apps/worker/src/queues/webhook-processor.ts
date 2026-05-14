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

            const insight = await prisma.aiInsight.create({
              data: {
                orgId: evt.orgId,
                kind: 'dust.agent_run',
                title: 'Dust Agent Insight',
                summary: output.slice(0, 5000),
                companyName: typeof data.company_name === 'string' ? data.company_name : null,
                opportunityId: typeof data.opportunity_id === 'string' ? data.opportunity_id : null,
                sourceAttribution: [
                  { source: 'dust.webhook', eventType, runId, eventId: Number(evt.id) },
                ] as Prisma.InputJsonValue,
              },
            });

            await prisma.auditLog.create({
              data: {
                orgId: evt.orgId,
                action: 'ai.insight.created',
                targetType: 'ai_insight',
                targetId: insight.id,
                diff: { source: 'dust.webhook', eventType, runId } as Prisma.InputJsonValue,
              },
            });
          } else {
            log.info({ eventType, eventId: evt.id }, 'unhandled dust webhook event type');
          }

          await prisma.syncEvent.update({
            where: { id: evt.id },
            data: { status: 'processed', processedAt: new Date() },
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.warn({ eventId: evt.id, error }, 'webhook event processing failed');
          await prisma.syncEvent.update({
            where: { id: evt.id },
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
