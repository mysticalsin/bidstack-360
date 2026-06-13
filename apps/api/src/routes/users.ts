import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AssignedRoleList,
  AssignRoleInput,
  CapabilityManifest,
} from '@bidstack/shared';

import { getUserPermissions } from '../services/rbac.service.js';

const OrgUser = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  createdAt: z.string().datetime(),
});

const IdParam = z.object({ id: z.string().uuid() });

function isAdminRole(legacyRole: string, roleNames: string[]): boolean {
  return legacyRole === 'admin' || roleNames.some((n) => n.toLowerCase() === 'admin');
}

export const usersRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /me/capabilities — the signed-in user's effective authorization. The
  // frontend uses this manifest (not a binary admin flag) to gate UI, finally
  // connecting the granular RBAC model to the product. Self-scoped, so no
  // permission gate: every authenticated user may read their own capabilities.
  server.get(
    '/me/capabilities',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { response: { 200: CapabilityManifest } },
    },
    async (req) => {
      const [permissions, roleRows] = await Promise.all([
        getUserPermissions(req),
        prisma.userRole.findMany({
          where: {
            userId: req.auth.userId,
            orgId: req.auth.orgId,
            deletedAt: null,
            role: { orgId: req.auth.orgId, deletedAt: null },
          },
          select: { role: { select: { name: true } } },
          take: 100,
        }),
      ]);
      const roles = roleRows.map((r) => r.role.name).sort();
      return {
        userId: req.auth.userId,
        orgId: req.auth.orgId,
        legacyRole: req.auth.role,
        roles,
        permissions,
        isAdmin: isAdminRole(req.auth.role, roles),
      };
    },
  );

  server.get(
    '/users',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          // WHY cursor pagination: a hard take:1000 silently drops users in
          // large orgs and loads the full set on every request even when the
          // caller needs a short dropdown. Cursor + limit fixes both.
          limit: z.coerce.number().int().min(1).max(200).default(100),
          cursor: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            items: z.array(OrgUser),
            nextCursor: z.string().uuid().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const { limit, cursor } = req.query;
      const rows = await prisma.user.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

      return {
        items: page.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
        })),
        nextCursor,
      };
    },
  );

  server.patch(
    '/users/:id/role',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('users:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ role: z.enum(['member', 'admin']) }),
        response: { 200: OrgUser },
      },
    },
    async (req) => {
      const user = await prisma.user.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!user) throw server.httpErrors.notFound('User not found');
      const updateResult = await prisma.user.updateMany({
        where: { id: user.id, orgId: req.auth.orgId },
        data: { role: req.body.role },
      });
      if (updateResult.count === 0) {
        throw server.httpErrors.notFound('User not found');
      }
      const updated = await prisma.user.findFirstOrThrow({
        where: { id: user.id, orgId: req.auth.orgId },
      });
      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        createdAt: updated.createdAt.toISOString(),
      };
    },
  );

  // ─── Granular role assignment (UserRole) ─────────────────────────────────
  // Assigning a custom Role is what finally lets admins drive authorization
  // from the product instead of only the seed. Admin + users:write gated and
  // audited; the per-request permission cache means the next request reflects
  // the change automatically.

  // GET /users/:id/roles — the custom roles a user currently holds.
  server.get(
    '/users/:id/roles',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('users:read'), server.requireRole('admin')],
      schema: { params: IdParam, response: { 200: AssignedRoleList } },
    },
    async (req) => {
      const user = await prisma.user.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw server.httpErrors.notFound('User not found');
      const rows = await prisma.userRole.findMany({
        where: {
          userId: user.id,
          orgId: req.auth.orgId,
          deletedAt: null,
          role: { orgId: req.auth.orgId, deletedAt: null },
        },
        select: {
          role: { select: { id: true, name: true, description: true, isSystem: true } },
        },
        take: 100,
      });
      return {
        items: rows.map((r) => ({
          roleId: r.role.id,
          name: r.role.name,
          description: r.role.description,
          isSystem: r.role.isSystem,
        })),
      };
    },
  );

  // POST /users/:id/roles — grant a custom role. Idempotent: re-granting a
  // previously revoked role clears its soft-delete rather than erroring.
  server.post(
    '/users/:id/roles',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('users:write'), server.requireRole('admin')],
      schema: { params: IdParam, body: AssignRoleInput, response: { 200: AssignedRoleList } },
    },
    async (req) => {
      const [user, role] = await Promise.all([
        prisma.user.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        }),
        prisma.role.findFirst({
          where: { id: req.body.roleId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true, name: true },
        }),
      ]);
      if (!user) throw server.httpErrors.notFound('User not found');
      if (!role) throw server.httpErrors.badRequest('Role not found in this org');

      await prisma.$transaction(async (tx) => {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: role.id } },
          // Re-grant: clear any prior soft-delete. orgId stays pinned to caller.
          update: { deletedAt: null, orgId: req.auth.orgId },
          create: { userId: user.id, roleId: role.id, orgId: req.auth.orgId },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'user_role.assign',
            targetType: 'user',
            targetId: user.id,
            diff: { roleId: role.id, roleName: role.name },
          },
        });
      });

      const rows = await prisma.userRole.findMany({
        where: {
          userId: user.id,
          orgId: req.auth.orgId,
          deletedAt: null,
          role: { orgId: req.auth.orgId, deletedAt: null },
        },
        select: {
          role: { select: { id: true, name: true, description: true, isSystem: true } },
        },
        take: 100,
      });
      return {
        items: rows.map((r) => ({
          roleId: r.role.id,
          name: r.role.name,
          description: r.role.description,
          isSystem: r.role.isSystem,
        })),
      };
    },
  );

  // DELETE /users/:id/roles/:roleId — revoke a custom role (soft delete).
  server.delete(
    '/users/:id/roles/:roleId',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('users:write'), server.requireRole('admin')],
      schema: {
        params: z.object({ id: z.string().uuid(), roleId: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const result = await prisma.userRole.updateMany({
        where: {
          userId: req.params.id,
          roleId: req.params.roleId,
          orgId: req.auth.orgId,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw server.httpErrors.notFound('Role assignment not found');
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'user_role.revoke',
          targetType: 'user',
          targetId: req.params.id,
          diff: { roleId: req.params.roleId },
        },
      });
      return reply.code(204).send(null);
    },
  );
};
