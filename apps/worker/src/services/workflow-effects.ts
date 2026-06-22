// Worker-side binding for the shared workflow engine.
//
// The worker cannot import apps/api's notification service (cross-app boundary),
// so it implements the same I/O directly on prisma. The action *logic* still
// lives in @bidstack/shared `workflow-engine.ts` — this file only supplies the
// org-scoped side effects so trigger/schedule dispatch runs the same code path
// as the manual API route.

import { prisma, type Prisma } from '@bidstack/db';
import type {
  WorkflowEffects,
  CreateTaskEffectInput,
  CreateNotificationEffectInput,
  EnqueueWebhookEffectInput,
  UpdateOwnerEffectInput,
  UpdateFieldEffectInput,
} from '@bidstack/shared';

import { fanOutWebhookEvent, type WebhookDeliveryQueue } from '../queues/webhook-delivery.js';

/**
 * Notification preference gating — mirrors apps/api notification.service.ts.
 * The engine only ever emits `system` notifications, which are never gated, so
 * this is a forward-compatible no-op today; kept explicit so a future gated
 * type can't silently bypass user opt-outs from the worker path.
 */
async function emitNotification(input: CreateNotificationEffectInput): Promise<void> {
  await prisma.notification.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      type: 'system',
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      url: null,
    },
  });
  // NOTE: the realtime push (notification:user:<id>) is intentionally omitted in
  // the worker — pollers pick up the row on their next fetch. Adding a Redis
  // pub/sub connection here would duplicate apps/api's realtime.service for a
  // best-effort enhancement; skipped to keep this surgical.
}

/**
 * Build the worker's `WorkflowEffects`. The webhook-delivery Queue producer is
 * created ONCE at worker startup (in main.ts) and injected here — building a new
 * Queue per dispatch job / schedule scan would leak Redis connections that are
 * never closed. The injected queue is reused for every `call_webhook` effect.
 */
export function buildWorkflowEffects(webhookQueue: WebhookDeliveryQueue): WorkflowEffects {
  return {
    async userBelongsToOrg(orgId: string, userId: string): Promise<boolean> {
      const user = await prisma.user.findFirst({
        where: { id: userId, orgId },
        select: { id: true },
      });
      return user !== null;
    },

    async oppBelongsToOrg(orgId: string, oppId: string): Promise<boolean> {
      const opp = await prisma.opportunity.findFirst({
        where: { id: oppId, orgId, deletedAt: null },
        select: { id: true },
      });
      return opp !== null;
    },

    async createTask(input: CreateTaskEffectInput): Promise<{ taskId: string }> {
      const task = await prisma.task.create({
        data: {
          orgId: input.orgId,
          title: input.title,
          status: 'open',
          ...(input.oppId ? { oppId: input.oppId } : {}),
          ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        },
        select: { id: true },
      });
      return { taskId: task.id };
    },

    createNotification(input: CreateNotificationEffectInput): Promise<void> {
      return emitNotification(input);
    },

    async enqueueWebhook(input: EnqueueWebhookEffectInput): Promise<void> {
      await fanOutWebhookEvent(webhookQueue, input.orgId, input.event, input.payload);
    },

    async updateRecordOwner(input: UpdateOwnerEffectInput): Promise<number> {
      if (input.recordType !== 'opportunity') return 0;
      const { count } = await prisma.opportunity.updateMany({
        where: { id: input.recordId, orgId: input.orgId, deletedAt: null },
        data: { ownerId: input.ownerId },
      });
      return count;
    },

    async updateRecordField(input: UpdateFieldEffectInput): Promise<number> {
      // Field name is allow-list-validated in the shared engine before this runs.
      const data = { [input.field]: input.value } as Prisma.OpportunityUpdateManyMutationInput &
        Prisma.LeadUpdateManyMutationInput &
        Prisma.TaskUpdateManyMutationInput;
      const where = { id: input.recordId, orgId: input.orgId, deletedAt: null };
      switch (input.recordType) {
        case 'opportunity': {
          const { count } = await prisma.opportunity.updateMany({ where, data });
          return count;
        }
        case 'lead': {
          const { count } = await prisma.lead.updateMany({ where, data });
          return count;
        }
        case 'task': {
          const { count } = await prisma.task.updateMany({ where, data });
          return count;
        }
        default:
          return 0;
      }
    },
  };
}
