// Role-based access control helpers.
//
// Fastify's `onRequest` hook runs after auth but before the route handler,
// making it the right place to enforce role gates. We attach helpers to the
// server instance so route modules can reuse them without importing a global.

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { prisma } from '@bidstack/db';
import type { PermissionKey } from '@bidstack/shared';

declare module 'fastify' {
  interface FastifyInstance {
    requireRole: (...allowed: string[]) => (req: FastifyRequest) => Promise<void>;
    requirePermission: (permission: PermissionKey) => (req: FastifyRequest) => Promise<void>;
  }
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  server.decorate('requireRole', (...allowed: string[]) => async (req: FastifyRequest) => {
    if (allowed.includes(req.auth.role)) return;

    const assignedRoleCount = await prisma.userRole.count({
      where: {
        userId: req.auth.userId,
        user: { orgId: req.auth.orgId, deletedAt: null },
        role: {
          orgId: req.auth.orgId,
          name: { in: allowed },
          deletedAt: null,
        },
      },
    });

    if (assignedRoleCount === 0) {
      throw req.server.httpErrors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
  });

  server.decorate(
    'requirePermission',
    (permission: PermissionKey) => async (req: FastifyRequest) => {
      const assignedPermissionCount = await prisma.userRole.count({
        where: {
          userId: req.auth.userId,
          user: { orgId: req.auth.orgId, deletedAt: null },
          role: {
            orgId: req.auth.orgId,
            deletedAt: null,
            permissions: {
              some: {
                permission: { key: permission },
              },
            },
          },
        },
      });

      if (assignedPermissionCount > 0) return;

      // Transitional fallback for seeded/dev accounts while system roles are being
      // backfilled into UserRole. New route gates should rely on requirePermission.
      if (req.auth.role === 'admin') return;

      throw req.server.httpErrors.forbidden(`Requires permission: ${permission}`);
    },
  );
});

export const rbacPlugin = plugin;
