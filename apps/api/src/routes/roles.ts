import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_WITH_PERMISSIONS = {
  permissions: {
    include: { permission: { select: { id: true, key: true, name: true } } },
  },
} satisfies Prisma.RoleInclude;

const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.string().datetime(),
  permissions: z.array(z.object({ id: z.string().uuid(), key: z.string(), name: z.string() })),
});

const PermissionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

export const roleRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/roles
  server.get(
    '/roles',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('settings:read'), server.requireRole('admin')],
      schema: { response: { 200: z.object({ items: z.array(RoleSchema) }) } },
    },
    async (req) => {
      const roles = await prisma.role.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        include: ROLE_WITH_PERMISSIONS,
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      return {
        items: roles.map(serializeRole),
      };
    },
  );

  // GET /api/permissions
  server.get(
    '/permissions',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('settings:read'), server.requireRole('admin')],
      schema: { response: { 200: z.object({ items: z.array(PermissionSchema) }) } },
    },
    async () => {
      const permissions = await prisma.permission.findMany({
        orderBy: { name: 'asc' },
        take: 500,
      });
      return {
        items: permissions.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          description: p.description,
        })),
      };
    },
  );

  // POST /api/roles
  server.post(
    '/roles',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        body: z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          permissionIds: z.array(z.string().uuid()).default([]),
        }),
        response: { 201: RoleSchema },
      },
    },
    async (req, reply) => {
      const permissions = await loadPermissionsById(req.body.permissionIds, server);
      const roleWithPerms = await prisma.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: {
            orgId: req.auth.orgId,
            name: req.body.name,
            description: req.body.description ?? null,
          },
        });
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({
              roleId: role.id,
              permissionId: permission.id,
              orgId: req.auth.orgId,
            })),
            skipDuplicates: true,
          });
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'role.create',
            targetType: 'role',
            targetId: role.id,
            diff: {
              ...actorDiff(req.auth.userId),
              name: role.name,
              description: role.description,
              permissionIds: permissions.map((permission) => permission.id),
              permissionKeys: permissions.map((permission) => permission.key),
            },
          },
        });
        return tx.role.findFirstOrThrow({
          where: { id: role.id, orgId: req.auth.orgId, deletedAt: null },
          include: ROLE_WITH_PERMISSIONS,
        });
      });
      reply.status(201);
      return serializeRole(roleWithPerms);
    },
  );

  // PATCH /api/roles/:id
  server.patch(
    '/roles/:id',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional(),
          permissionIds: z.array(z.string().uuid()).optional(),
        }),
        response: { 200: RoleSchema },
      },
    },
    async (req) => {
      const role = await prisma.$transaction(async (tx) => {
        const before = await tx.role.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
          include: ROLE_WITH_PERMISSIONS,
        });
        if (!before) throw server.httpErrors.notFound('Role not found');
        if (before.isSystem) throw server.httpErrors.forbidden('Cannot modify system roles');

        const data: {
          name?: string;
          description?: string | null;
        } = {};
        if (req.body.name !== undefined) data.name = req.body.name;
        if (req.body.description !== undefined) data.description = req.body.description ?? null;

        // WHY: only call updateMany when there are actual fields to change.
        // updateMany({ data: {} }) returns count:0 even when the row exists,
        // which would otherwise produce a spurious 404 for permission-only PATCHes.
        if (Object.keys(data).length > 0) {
          const updateResult = await tx.role.updateMany({
            where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
            data,
          });
          // Role existed at findFirst above; count=0 here means a concurrent delete.
          if (updateResult.count === 0) {
            throw server.httpErrors.notFound('Role not found');
          }
        }

        if (req.body.permissionIds !== undefined) {
          const uniquePermissionIds = Array.from(new Set(req.body.permissionIds));
          // BS-33: validate that every supplied permissionId actually exists
          // before wiring them to the role. Unknown IDs are silently skipped by
          // skipDuplicates; validating here surfaces bad input with a clear 400.
          if (uniquePermissionIds.length > 0) {
            const found = await tx.permission.findMany({
              where: { id: { in: uniquePermissionIds } },
              select: { id: true },
              // WHY take: callers supply ≤ permissionIds.length IDs; bounded by the
              // Zod array validator on the request body. Explicit cap prevents the
              // unbounded-findMany guard from blocking this legitimate query.
              take: uniquePermissionIds.length,
            });
            if (found.length !== uniquePermissionIds.length) {
              const foundIds = new Set(found.map((p) => p.id));
              const bad = uniquePermissionIds.filter((pid) => !foundIds.has(pid));
              throw server.httpErrors.badRequest(`Unknown permissionId(s): ${bad.join(', ')}`);
            }
          }
          await tx.rolePermission.deleteMany({
            where: { roleId: req.params.id, orgId: req.auth.orgId },
          });
          if (uniquePermissionIds.length > 0) {
            await tx.rolePermission.createMany({
              data: uniquePermissionIds.map((pid) => ({
                roleId: req.params.id,
                permissionId: pid,
                orgId: req.auth.orgId,
              })),
              skipDuplicates: true,
            });
          }
        }

        const after = await tx.role.findFirstOrThrow({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
          include: ROLE_WITH_PERMISSIONS,
        });

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'role.update',
            targetType: 'role',
            targetId: after.id,
            diff: roleUpdateDiff(before, after, req.auth.userId, req.body),
          },
        });

        return after;
      });

      return serializeRole(role);
    },
  );

  // DELETE /api/roles/:id
  server.delete(
    '/roles/:id',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.role.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
          include: ROLE_WITH_PERMISSIONS,
        });
        if (!existing) throw server.httpErrors.notFound('Role not found');
        if (existing.isSystem) throw server.httpErrors.forbidden('Cannot delete system roles');

        const updateResult = await tx.role.updateMany({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        });

        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Role not found');
        }

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: auditUserId(req.auth.userId),
            action: 'role.delete',
            targetType: 'role',
            targetId: existing.id,
            diff: roleDeleteDiff(existing, req.auth.userId),
          },
        });
      });

      return reply.status(204).send();
    },
  );
};

type RoleWithPermissions = Prisma.RoleGetPayload<{ include: typeof ROLE_WITH_PERMISSIONS }>;
type PermissionAudit = { id: string; key: string; name: string };
type RolePatchBody = {
  name?: string;
  description?: string;
  permissionIds?: string[];
};
type MutableJsonObject = Record<string, Prisma.InputJsonValue>;

function serializeRole(role: RoleWithPermissions): z.infer<typeof RoleSchema> {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    createdAt: role.createdAt.toISOString(),
    permissions: role.permissions.map((rp) => rp.permission),
  };
}

async function loadPermissionsById(
  permissionIds: string[],
  server: FastifyInstance,
): Promise<PermissionAudit[]> {
  const uniquePermissionIds = Array.from(new Set(permissionIds));
  if (uniquePermissionIds.length === 0) return [];

  const found = await prisma.permission.findMany({
    where: { id: { in: uniquePermissionIds } },
    select: { id: true, key: true, name: true },
    take: uniquePermissionIds.length,
  });
  if (found.length !== uniquePermissionIds.length) {
    const foundIds = new Set(found.map((permission) => permission.id));
    const bad = uniquePermissionIds.filter((permissionId) => !foundIds.has(permissionId));
    throw server.httpErrors.badRequest(`Unknown permissionId(s): ${bad.join(', ')}`);
  }

  const byId = new Map(found.map((permission) => [permission.id, permission]));
  return uniquePermissionIds.map((permissionId) => byId.get(permissionId)!);
}

function auditUserId(userId: string): string | null {
  return UUID_RE.test(userId) ? userId : null;
}

function actorDiff(userId: string): Prisma.InputJsonObject {
  return {
    actorId: userId,
    actorKind: userId.startsWith('apikey:') ? 'api_key' : 'user',
  };
}

function roleUpdateDiff(
  before: RoleWithPermissions,
  after: RoleWithPermissions,
  userId: string,
  patch: RolePatchBody,
): Prisma.InputJsonObject {
  const changes: MutableJsonObject = {};
  if (patch.name !== undefined && before.name !== after.name) {
    changes.name = { from: before.name, to: after.name };
  }
  if (patch.description !== undefined && before.description !== after.description) {
    changes.description = { from: before.description, to: after.description };
  }

  const beforeIds = rolePermissionIds(before);
  const afterIds = rolePermissionIds(after);
  if (patch.permissionIds !== undefined && !sameStrings(beforeIds, afterIds)) {
    changes.permissions = {
      fromIds: beforeIds,
      toIds: afterIds,
      fromKeys: rolePermissionKeys(before),
      toKeys: rolePermissionKeys(after),
    };
  }

  return {
    ...actorDiff(userId),
    requestedFields: Object.keys(patch),
    changedFields: Object.keys(changes),
    changes,
  };
}

function roleDeleteDiff(role: RoleWithPermissions, userId: string): Prisma.InputJsonObject {
  return {
    ...actorDiff(userId),
    name: role.name,
    description: role.description,
    permissionIds: rolePermissionIds(role),
    permissionKeys: rolePermissionKeys(role),
  };
}

function rolePermissionIds(role: RoleWithPermissions): string[] {
  return role.permissions.map((rp) => rp.permission.id).sort();
}

function rolePermissionKeys(role: RoleWithPermissions): string[] {
  return role.permissions.map((rp) => rp.permission.key).sort();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
