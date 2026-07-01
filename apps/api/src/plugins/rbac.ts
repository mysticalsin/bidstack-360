// Role-based access control helpers.
//
// Fastify's `onRequest` hook runs after auth but before the route handler,
// making it the right place to enforce role gates. We attach helpers to the
// server instance so route modules can reuse them without importing a global.

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { PermissionKey } from '@bidstack/shared';

import {
  apiKeyScopeSatisfiesPermission,
  allowLegacyRestApiKeyScopes,
} from '../lib/api-key-scopes.js';
import { userHasAnyRole, userHasPermission } from '../lib/rbac-decision-cache.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireRole: (...allowed: string[]) => (req: FastifyRequest) => Promise<void>;
    requirePermission: (permission: PermissionKey) => (req: FastifyRequest) => Promise<void>;
    requireHumanActor: (message?: string) => (req: FastifyRequest) => Promise<void>;
  }
  // WHY: route config: { permission: '...' } is a convenience annotation used
  // by observability middleware to log which permission gate a route enforces.
  // Augmenting FastifyContextConfig prevents TS2345 on all routes that set it.
  interface FastifyContextConfig {
    permission?: PermissionKey;
  }
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  server.decorate(
    'requireHumanActor',
    (message = 'Requires a user session') =>
      async (req: FastifyRequest) => {
        if (req.auth.role === 'api' || req.auth.userId.startsWith('apikey:')) {
          throw req.server.httpErrors.forbidden(message);
        }
      },
  );

  server.decorate('requireRole', (...allowed: string[]) => async (req: FastifyRequest) => {
    if (req.auth.role === 'api') {
      throw req.server.httpErrors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
    const allowedByDb = await userHasAnyRole(req.auth.orgId, req.auth.userId, allowed);
    if (!allowedByDb) {
      throw req.server.httpErrors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
  });

  server.decorate(
    'requirePermission',
    (permission: PermissionKey) => async (req: FastifyRequest) => {
      if (req.auth.role === 'api') {
        if (apiKeyScopeSatisfiesPermission(req.auth.scopes, permission)) return;
        const legacyDetail = allowLegacyRestApiKeyScopes()
          ? ` or legacy ${permission.endsWith(':write') ? 'write' : 'read'}`
          : '';
        throw req.server.httpErrors.forbidden(
          `Requires API key scope: ${permission}${legacyDetail}`,
        );
      }

      if (await userHasPermission(req.auth.orgId, req.auth.userId, permission)) return;

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
