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

      // No claim-based fallback. The previous code allowed `req.auth.role === 'admin'`
      // through unconditionally, which bypassed every granular check whenever the
      // UserRole rows had not been backfilled. Admins must hold an explicit UserRole
      // grant — see docs/adr/0001-rbac-no-claim-fallback.md and the JIT provisioning
      // in apps/api/src/plugins/auth.ts that ensures Clerk org-admins receive the
      // seeded "Admin" Role on first sign-in.
      throw req.server.httpErrors.forbidden(`Requires permission: ${permission}`);
    },
  );
});

export const rbacPlugin = plugin;
