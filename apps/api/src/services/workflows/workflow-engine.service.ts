// API-side binding for the shared workflow engine.
//
// Supplies a `WorkflowEffects` implementation backed by this app's prisma
// client, the canonical notification creator, and the webhook-delivery enqueue
// seam. The action *logic* (allow-list, SSRF gate, condition matching) lives in
// @bidstack/shared `workflow-engine.ts`; this file only wires the I/O so the
// manual `POST /workflows/:id/run` route runs the exact same code path the
// worker uses for trigger/schedule dispatch.

import { prisma, type Prisma } from '@bidstack/db';
import type {
  WorkflowEffects,
  CreateTaskEffectInput,
  CreateNotificationEffectInput,
  EnqueueWebhookEffectInput,
  UpdateOwnerEffectInput,
  UpdateFieldEffectInput,
} from '@bidstack/shared';

import { createNotification } from '../notification.service.js';
import { fanOutWebhookEvent } from '../../queues/webhook-delivery.js';

/** Single shared instance — stateless, safe to reuse across requests. */
export const apiWorkflowEffects: WorkflowEffects = {
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

  async createNotification(input: CreateNotificationEffectInput): Promise<void> {
    await createNotification({
      orgId: input.orgId,
      userId: input.userId,
      type: 'system',
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    });
  },

  async enqueueWebhook(input: EnqueueWebhookEffectInput): Promise<void> {
    // fanOutWebhookEvent is fail-open (logs + swallows). Await so a per-step
    // result reflects that the enqueue was attempted.
    await fanOutWebhookEvent(input.orgId, input.event, input.payload);
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
    // The field name is allow-list-validated in the shared engine before this
    // is called, so the dynamic key is safe to apply. Cast is required because
    // Prisma's generated update types can't accept a runtime-keyed field.
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
        // Task has no deletedAt-null requirement difference; keep org scope.
        const { count } = await prisma.task.updateMany({
          where: { id: input.recordId, orgId: input.orgId, deletedAt: null },
          data,
        });
        return count;
      }
      default:
        return 0;
    }
  },
};
