// Cross-sell action log (A2) — structured cross-country/cross-team actions on
// shared accounts. Pre-sales owns it; assignable + status-tracked.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  CrossSellAction,
  CrossSellActionCreate,
  CrossSellActionFilter,
  CrossSellActionPage,
  CrossSellActionPatch,
} from '@bidstack/shared';

import { normalizeName } from '../services/crm/dashboard.utils.js';
import { createNotification } from '../services/notification.service.js';

const IdParam = z.object({ id: z.string().uuid() });

interface DbRow {
  id: string;
  accountKey: string;
  description: string;
  requestingUnit: string;
  assignedUnit: string;
  assigneeId: string | null;
  assignee: { name: string | null; email: string } | null;
  dueDate: Date | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(row: DbRow): z.infer<typeof CrossSellAction> {
  return {
    id: row.id,
    accountKey: row.accountKey,
    description: row.description,
    requestingUnit: row.requestingUnit,
    assignedUnit: row.assignedUnit,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? row.assignee?.email ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    status: row.status as z.infer<typeof CrossSellAction>['status'],
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ASSIGNEE_SELECT = {
  id: true,
  accountKey: true,
  description: true,
  requestingUnit: true,
  assignedUnit: true,
  assigneeId: true,
  assignee: { select: { name: true, email: true } },
  dueDate: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Validate an optional assignee belongs to the caller's org. */
async function assertAssignee(orgId: string, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const user = await prisma.user.findFirst({
    where: { id: assigneeId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new Error('ASSIGNEE_NOT_IN_ORG');
}

export const crossSellRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/cross-sell-actions',
    { schema: { querystring: CrossSellActionFilter, response: { 200: CrossSellActionPage } } },
    async (req) => {
      const rows = await prisma.crossSellAction.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.accountKey ? { accountKey: normalizeName(req.query.accountKey) } : {}),
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        select: ASSIGNEE_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { items: rows.map(serialize) };
    },
  );

  server.post(
    '/cross-sell-actions',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { body: CrossSellActionCreate, response: { 201: CrossSellAction } },
    },
    async (req, reply) => {
      try {
        await assertAssignee(req.auth.orgId, req.body.assigneeId);
      } catch {
        throw server.httpErrors.badRequest('Assignee is not a member of this org');
      }
      const created = await prisma.crossSellAction.create({
        data: {
          orgId: req.auth.orgId,
          accountKey: normalizeName(req.body.accountKey),
          description: req.body.description,
          requestingUnit: req.body.requestingUnit,
          assignedUnit: req.body.assignedUnit,
          assigneeId: req.body.assigneeId ?? null,
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          status: req.body.status,
          notes: req.body.notes ?? null,
          createdById: req.auth.userId,
        },
        select: ASSIGNEE_SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'cross_sell_action.create',
          targetType: 'cross_sell_action',
          targetId: created.id,
          diff: { accountKey: created.accountKey, assignedUnit: created.assignedUnit },
        },
      });
      // Tell the assignee they own a new cross-sell action (best-effort).
      if (created.assigneeId && created.assigneeId !== req.auth.userId) {
        await createNotification({
          orgId: req.auth.orgId,
          userId: created.assigneeId,
          type: 'assignment',
          title: 'New cross-sell action assigned to you',
          body: created.description.slice(0, 160),
          entityType: 'cross_sell_action',
          entityId: created.id,
          url: `/accounts/${created.accountKey}`,
        }).catch(() => {});
      }
      return reply.code(201).send(serialize(created));
    },
  );

  server.patch(
    '/cross-sell-actions/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, body: CrossSellActionPatch, response: { 200: CrossSellAction } },
    },
    async (req) => {
      const existing = await prisma.crossSellAction.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, assigneeId: true },
      });
      if (!existing) throw server.httpErrors.notFound('Cross-sell action not found');
      if (req.body.assigneeId !== undefined) {
        try {
          await assertAssignee(req.auth.orgId, req.body.assigneeId);
        } catch {
          throw server.httpErrors.badRequest('Assignee is not a member of this org');
        }
      }
      await prisma.crossSellAction.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.requestingUnit !== undefined
            ? { requestingUnit: req.body.requestingUnit }
            : {}),
          ...(req.body.assignedUnit !== undefined ? { assignedUnit: req.body.assignedUnit } : {}),
          ...(req.body.assigneeId !== undefined ? { assigneeId: req.body.assigneeId } : {}),
          ...(req.body.dueDate !== undefined
            ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
            : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
          ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
        },
      });
      const updated = await prisma.crossSellAction.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId },
        select: ASSIGNEE_SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'cross_sell_action.update',
          targetType: 'cross_sell_action',
          targetId: updated.id,
          diff: req.body as object,
        },
      });
      // Notify only on a real re-assignment to a different, non-actor user.
      if (
        updated.assigneeId &&
        updated.assigneeId !== existing.assigneeId &&
        updated.assigneeId !== req.auth.userId
      ) {
        await createNotification({
          orgId: req.auth.orgId,
          userId: updated.assigneeId,
          type: 'assignment',
          title: 'A cross-sell action was assigned to you',
          body: updated.description.slice(0, 160),
          entityType: 'cross_sell_action',
          entityId: updated.id,
          url: `/accounts/${updated.accountKey}`,
        }).catch(() => {});
      }
      return serialize(updated);
    },
  );

  server.delete(
    '/cross-sell-actions/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.crossSellAction.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Cross-sell action not found');
      await prisma.$transaction([
        prisma.crossSellAction.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'cross_sell_action.delete',
            targetType: 'cross_sell_action',
            targetId: existing.id,
            diff: {},
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );
};
