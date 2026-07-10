// Comitology / governance meeting log (A4) — per-account governance meetings
// plus their assigned actions. Pre-sales has no visibility today; this fills it.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  GovernanceActionInput,
  GovernanceActionPatch,
  GovernanceMeeting,
  GovernanceMeetingCreate,
  GovernanceMeetingList,
  GovernanceMeetingPatch,
} from '@bidstack/shared';

import { normalizeName } from '../services/crm/dashboard.utils.js';
import { createNotification } from '../services/notification.service.js';

const IdParam = z.object({ id: z.string().uuid() });
const ActionParams = z.object({ id: z.string().uuid(), actionId: z.string().uuid() });

interface DbAction {
  id: string;
  meetingId: string;
  description: string;
  ownerId: string | null;
  owner: { name: string | null; email: string } | null;
  dueDate: Date | null;
  status: string;
  createdAt: Date;
}
interface DbMeeting {
  id: string;
  accountKey: string;
  meetingType: string;
  date: Date;
  participants: string[];
  outcomes: string | null;
  actions: DbAction[];
  createdAt: Date;
  updatedAt: Date;
}

const MEETING_SELECT = {
  id: true,
  accountKey: true,
  meetingType: true,
  date: true,
  participants: true,
  outcomes: true,
  createdAt: true,
  updatedAt: true,
  actions: {
    select: {
      id: true,
      meetingId: true,
      description: true,
      ownerId: true,
      owner: { select: { name: true, email: true } },
      dueDate: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} as const;

function serializeAction(a: DbAction): z.infer<typeof GovernanceMeeting>['actions'][number] {
  return {
    id: a.id,
    meetingId: a.meetingId,
    description: a.description,
    ownerId: a.ownerId,
    ownerName: a.owner?.name ?? a.owner?.email ?? null,
    dueDate: a.dueDate?.toISOString() ?? null,
    status: a.status as 'open' | 'in_progress' | 'done',
    createdAt: a.createdAt.toISOString(),
  };
}

function serialize(m: DbMeeting): z.infer<typeof GovernanceMeeting> {
  return {
    id: m.id,
    accountKey: m.accountKey,
    meetingType: m.meetingType as z.infer<typeof GovernanceMeeting>['meetingType'],
    date: m.date.toISOString(),
    participants: m.participants,
    outcomes: m.outcomes,
    actions: m.actions.map(serializeAction),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

async function assertOwner(orgId: string, ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const user = await prisma.user.findFirst({
    where: { id: ownerId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new Error('OWNER_NOT_IN_ORG');
}

export const governanceRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/governance-meetings',
    {
      schema: {
        querystring: z.object({ accountKey: z.string().min(1).max(255) }),
        response: { 200: GovernanceMeetingList },
      },
    },
    async (req) => {
      const rows = await prisma.governanceMeeting.findMany({
        where: { orgId: req.auth.orgId, accountKey: normalizeName(req.query.accountKey), deletedAt: null },
        select: MEETING_SELECT,
        orderBy: { date: 'desc' },
        take: 100,
      });
      return { items: rows.map(serialize) };
    },
  );

  server.post(
    '/governance-meetings',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { body: GovernanceMeetingCreate, response: { 201: GovernanceMeeting } },
    },
    async (req, reply) => {
      for (const action of req.body.actions) {
        try {
          await assertOwner(req.auth.orgId, action.ownerId);
        } catch {
          throw server.httpErrors.badRequest('Action owner is not a member of this org');
        }
      }
      const created = await prisma.governanceMeeting.create({
        data: {
          orgId: req.auth.orgId,
          accountKey: normalizeName(req.body.accountKey),
          meetingType: req.body.meetingType,
          date: new Date(req.body.date),
          participants: req.body.participants,
          outcomes: req.body.outcomes ?? null,
          createdById: req.auth.userId,
          actions: {
            create: req.body.actions.map((a) => ({
              orgId: req.auth.orgId,
              description: a.description,
              ownerId: a.ownerId ?? null,
              dueDate: a.dueDate ? new Date(a.dueDate) : null,
              status: a.status,
            })),
          },
        },
        select: MEETING_SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'governance_meeting.create',
          targetType: 'governance_meeting',
          targetId: created.id,
          diff: { accountKey: created.accountKey, meetingType: created.meetingType },
        },
      });
      return reply.code(201).send(serialize(created));
    },
  );

  server.patch(
    '/governance-meetings/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, body: GovernanceMeetingPatch, response: { 200: GovernanceMeeting } },
    },
    async (req) => {
      const existing = await prisma.governanceMeeting.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Meeting not found');
      await prisma.governanceMeeting.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(req.body.meetingType !== undefined ? { meetingType: req.body.meetingType } : {}),
          ...(req.body.date !== undefined ? { date: new Date(req.body.date) } : {}),
          ...(req.body.participants !== undefined ? { participants: req.body.participants } : {}),
          ...(req.body.outcomes !== undefined ? { outcomes: req.body.outcomes } : {}),
        },
      });
      const updated = await prisma.governanceMeeting.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId },
        select: MEETING_SELECT,
      });
      return serialize(updated);
    },
  );

  server.post(
    '/governance-meetings/:id/actions',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, body: GovernanceActionInput, response: { 201: GovernanceMeeting } },
    },
    async (req, reply) => {
      const meeting = await prisma.governanceMeeting.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!meeting) throw server.httpErrors.notFound('Meeting not found');
      try {
        await assertOwner(req.auth.orgId, req.body.ownerId);
      } catch {
        throw server.httpErrors.badRequest('Action owner is not a member of this org');
      }
      const createdAction = await prisma.governanceAction.create({
        data: {
          orgId: req.auth.orgId,
          meetingId: meeting.id,
          description: req.body.description,
          ownerId: req.body.ownerId ?? null,
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          status: req.body.status,
        },
      });
      const updated = await prisma.governanceMeeting.findFirstOrThrow({
        where: { id: meeting.id, orgId: req.auth.orgId },
        select: MEETING_SELECT,
      });
      // Notify the named owner that a governance action is theirs (best-effort).
      if (createdAction.ownerId && createdAction.ownerId !== req.auth.userId) {
        await createNotification({
          orgId: req.auth.orgId,
          userId: createdAction.ownerId,
          type: 'assignment',
          title: 'A governance action was assigned to you',
          body: createdAction.description.slice(0, 160),
          entityType: 'governance_action',
          entityId: createdAction.id,
          url: `/accounts/${updated.accountKey}`,
        }).catch((err) => req.log.warn({ err }, 'governance action assignment notification failed'));
      }
      return reply.code(201).send(serialize(updated));
    },
  );

  server.patch(
    '/governance-meetings/:id/actions/:actionId',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: ActionParams, body: GovernanceActionPatch, response: { 200: GovernanceMeeting } },
    },
    async (req) => {
      // Resolve the live (non-deleted) parent meeting first, mirroring POST
      // /actions — patching an action on a soft-deleted meeting must 404.
      const meeting = await prisma.governanceMeeting.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!meeting) throw server.httpErrors.notFound('Meeting not found');
      const action = await prisma.governanceAction.findFirst({
        where: { id: req.params.actionId, meetingId: meeting.id, orgId: req.auth.orgId },
        select: { id: true, ownerId: true, description: true },
      });
      if (!action) throw server.httpErrors.notFound('Action not found');
      if (req.body.ownerId !== undefined) {
        try {
          await assertOwner(req.auth.orgId, req.body.ownerId);
        } catch {
          throw server.httpErrors.badRequest('Action owner is not a member of this org');
        }
      }
      await prisma.governanceAction.updateMany({
        where: { id: action.id, orgId: req.auth.orgId },
        data: {
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.ownerId !== undefined ? { ownerId: req.body.ownerId } : {}),
          ...(req.body.dueDate !== undefined
            ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
            : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
        },
      });
      const updated = await prisma.governanceMeeting.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: MEETING_SELECT,
      });
      // Notify only on a genuine re-assignment to a new, non-actor owner.
      const newOwnerId = req.body.ownerId;
      if (
        newOwnerId &&
        newOwnerId !== action.ownerId &&
        newOwnerId !== req.auth.userId
      ) {
        await createNotification({
          orgId: req.auth.orgId,
          userId: newOwnerId,
          type: 'assignment',
          title: 'A governance action was assigned to you',
          body: (req.body.description ?? action.description).slice(0, 160),
          entityType: 'governance_action',
          entityId: action.id,
          url: `/accounts/${updated.accountKey}`,
        }).catch((err) => req.log.warn({ err }, 'governance action reassignment notification failed'));
      }
      return serialize(updated);
    },
  );

  server.delete(
    '/governance-meetings/:id',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.governanceMeeting.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Meeting not found');
      await prisma.governanceMeeting.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send(null);
    },
  );
};
