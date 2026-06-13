// M7 — access groups admin CRUD (PLAN.md ADR-7).
//
// Admin-managed user groups that drive the access-scoping layer
// (lib/access-scope.ts). Groups mirror the source systems' (ABC,
// Opportunity Management) group access; until live connectors exist an
// org admin maintains them under Settings → Access groups.
//
// Gates follow the settings surface: settings:read for reads,
// settings:write for mutations. Every mutation is audit-logged and
// invalidates the in-process scope cache.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  UserGroup,
  UserGroupCreate,
  UserGroupList,
  UserGroupMemberAdd,
  UserGroupPatch,
  UserGroupWithMembers,
} from '@bidstack/shared';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';

const GroupIdParam = z.object({ id: z.string().uuid() });
const WRITE_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// audit_logs.user_id is a uuid FK — API-key actors ("apikey:<id>") go in the
// diff instead. Same convention as routes/roles.ts.
function auditUserId(userId: string): string | null {
  return UUID_RE.test(userId) ? userId : null;
}

function actorDiff(userId: string): Prisma.InputJsonObject {
  return {
    actorId: userId,
    actorKind: userId.startsWith('apikey:') ? 'api_key' : 'user',
  };
}

type GroupWithCount = Prisma.UserGroupGetPayload<{
  include: { _count: { select: { members: true } } };
}>;

function serializeGroup(g: GroupWithCount): UserGroup {
  return {
    id: g.id,
    orgId: g.orgId,
    name: g.name,
    description: g.description,
    scopeCountries: g.scopeCountries,
    scopeAll: g.scopeAll,
    memberCount: g._count.members,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

const GROUP_INCLUDE = { _count: { select: { members: true } } } as const;

export const userGroupRoutes: FastifyPluginAsyncZod = async (server) => {
  const findGroupOr404 = async (orgId: string, id: string) => {
    const group = await prisma.userGroup.findFirst({
      where: { id, orgId, deletedAt: null },
      include: GROUP_INCLUDE,
    });
    if (!group) throw server.httpErrors.notFound('Access group not found');
    return group;
  };

  // ─── GET /api/v1/user-groups ────────────────────────────────────────────
  server.get(
    '/user-groups',
    {
      preHandler: server.requirePermission('settings:read'),
      schema: { response: { 200: UserGroupList } },
    },
    async (req) => {
      const groups = await prisma.userGroup.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        include: GROUP_INCLUDE,
        orderBy: { name: 'asc' },
        take: 100,
      });
      return { items: groups.map(serializeGroup) };
    },
  );

  // ─── GET /api/v1/user-groups/:id — group + members (member editor) ─────
  server.get(
    '/user-groups/:id',
    {
      preHandler: server.requirePermission('settings:read'),
      schema: { params: GroupIdParam, response: { 200: UserGroupWithMembers } },
    },
    async (req) => {
      const group = await findGroupOr404(req.auth.orgId, req.params.id);
      const members = await prisma.userGroupMember.findMany({
        where: { orgId: req.auth.orgId, groupId: group.id },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      return {
        ...serializeGroup(group),
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  );

  // ─── POST /api/v1/user-groups ───────────────────────────────────────────
  server.post(
    '/user-groups',
    {
      config: WRITE_RATE_LIMIT,
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: { body: UserGroupCreate, response: { 201: UserGroup } },
    },
    async (req, reply) => {
      const duplicate = await prisma.userGroup.findFirst({
        where: { orgId: req.auth.orgId, name: req.body.name, deletedAt: null },
        select: { id: true },
      });
      if (duplicate) {
        throw server.httpErrors.conflict(`A group named "${req.body.name}" already exists`);
      }

      const created = await prisma.$transaction(async (tx) => {
        const group = await tx.userGroup.create({
          data: {
            orgId: req.auth.orgId,
            name: req.body.name,
            description: req.body.description ?? null,
            scopeCountries: req.body.scopeCountries,
            scopeAll: req.body.scopeAll,
          },
          include: GROUP_INCLUDE,
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'user_group.create',
            targetType: 'user_group',
            targetId: group.id,
            diff: {
              ...actorDiff(req.auth.userId),
              name: group.name,
              scopeCountries: group.scopeCountries,
              scopeAll: group.scopeAll,
            },
          },
        });
        return group;
      });
      return reply.code(201).send(serializeGroup(created));
    },
  );

  // ─── PATCH /api/v1/user-groups/:id ──────────────────────────────────────
  server.patch(
    '/user-groups/:id',
    {
      config: WRITE_RATE_LIMIT,
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: { params: GroupIdParam, body: UserGroupPatch, response: { 200: UserGroup } },
    },
    async (req) => {
      const before = await findGroupOr404(req.auth.orgId, req.params.id);

      const data: Prisma.UserGroupUpdateInput = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.scopeCountries !== undefined) data.scopeCountries = req.body.scopeCountries;
      if (req.body.scopeAll !== undefined) data.scopeAll = req.body.scopeAll;

      const updated = await prisma.$transaction(async (tx) => {
        const group = await tx.userGroup.update({
          where: { id: before.id, orgId: req.auth.orgId },
          data,
          include: GROUP_INCLUDE,
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'user_group.update',
            targetType: 'user_group',
            targetId: group.id,
            diff: {
              ...actorDiff(req.auth.userId),
              from: {
                name: before.name,
                scopeCountries: before.scopeCountries,
                scopeAll: before.scopeAll,
              },
              to: {
                name: group.name,
                scopeCountries: group.scopeCountries,
                scopeAll: group.scopeAll,
              },
            },
          },
        });
        return group;
      });
      // Scope rules changed — every member's cached scope is stale.
      invalidateAccessScope(req.auth.orgId);
      return serializeGroup(updated);
    },
  );

  // ─── DELETE /api/v1/user-groups/:id (soft delete) ───────────────────────
  server.delete(
    '/user-groups/:id',
    {
      config: WRITE_RATE_LIMIT,
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: { params: GroupIdParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const group = await findGroupOr404(req.auth.orgId, req.params.id);
      await prisma.$transaction(async (tx) => {
        await tx.userGroup.update({
          where: { id: group.id, orgId: req.auth.orgId },
          data: { deletedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'user_group.delete',
            targetType: 'user_group',
            targetId: group.id,
            diff: { ...actorDiff(req.auth.userId), name: group.name },
          },
        });
      });
      invalidateAccessScope(req.auth.orgId);
      return reply.code(204).send(null);
    },
  );

  // ─── POST /api/v1/user-groups/:id/members ───────────────────────────────
  server.post(
    '/user-groups/:id/members',
    {
      config: WRITE_RATE_LIMIT,
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: GroupIdParam,
        body: UserGroupMemberAdd,
        response: { 201: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const group = await findGroupOr404(req.auth.orgId, req.params.id);
      if (!(await tenantEntityBelongsToOrg('user', req.body.userId, req.auth.orgId))) {
        throw server.httpErrors.badRequest('User does not belong to this organization');
      }
      await prisma.$transaction(async (tx) => {
        // Upsert keeps re-adding idempotent (@@unique([groupId, userId])).
        await tx.userGroupMember.upsert({
          where: { groupId_userId: { groupId: group.id, userId: req.body.userId } },
          create: { orgId: req.auth.orgId, groupId: group.id, userId: req.body.userId },
          update: {},
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'user_group.member_add',
            targetType: 'user_group',
            targetId: group.id,
            diff: { ...actorDiff(req.auth.userId), memberUserId: req.body.userId },
          },
        });
      });
      invalidateAccessScope(req.auth.orgId, req.body.userId);
      return reply.code(201).send({ ok: true });
    },
  );

  // ─── DELETE /api/v1/user-groups/:id/members/:userId ─────────────────────
  server.delete(
    '/user-groups/:id/members/:userId',
    {
      config: WRITE_RATE_LIMIT,
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const group = await findGroupOr404(req.auth.orgId, req.params.id);
      const removed = await prisma.userGroupMember.deleteMany({
        where: { orgId: req.auth.orgId, groupId: group.id, userId: req.params.userId },
      });
      if (removed.count > 0) {
        await prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'user_group.member_remove',
            targetType: 'user_group',
            targetId: group.id,
            diff: { ...actorDiff(req.auth.userId), memberUserId: req.params.userId },
          },
        });
        invalidateAccessScope(req.auth.orgId, req.params.userId);
      }
      return reply.code(204).send(null);
    },
  );
};
