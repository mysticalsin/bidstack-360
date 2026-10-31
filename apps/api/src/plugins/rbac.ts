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
    /** Non-throwing permission check for conditionally including sensitive fields
     *  in a response (e.g. gate an admin-only field on an otherwise-readable
     *  route). Mirrors requirePermission's decision but returns a boolean. */
    hasPermission: (req: FastifyRequest, permission: PermissionKey) => Promise<boolean>;
  }
  // Route config: { permission: '...' } is ENFORCED by the global preHandler
  // registered below (secure-by-default: a declared gate can never silently be
  // decorative). Routes may still add explicit preHandler gates; the decision
  // cache makes the repeated check free.
  interface FastifyContextConfig {
    permission?: PermissionKey;
  }
}

/**
 * Give each guard a stable, greppable function name ("rbac:permission(leads:read)")
 * so route census tooling (printRoutes({ includeHooks: true })) can prove that
 * every route is covered by an RBAC gate. Behaviour is unchanged.
 */
function named<T extends (...args: never[]) => unknown>(name: string, fn: T): T {
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  server.decorate(
    'requireHumanActor',
    (message = 'Requires a user session') =>
      named('rbac:human', async (req: FastifyRequest) => {
        if (req.auth.role === 'api' || req.auth.userId.startsWith('apikey:')) {
          throw req.server.httpErrors.forbidden(message);
        }
      }),
  );

  server.decorate('requireRole', (...allowed: string[]) => named(`rbac:role(${allowed.join('|')})`, async (req: FastifyRequest) => {
    if (req.auth.role === 'api') {
      throw req.server.httpErrors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
    const allowedByDb = await userHasAnyRole(req.auth.orgId, req.auth.userId, allowed);
    if (!allowedByDb) {
      throw req.server.httpErrors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
  }));

  server.decorate(
    'requirePermission',
    (permission: PermissionKey) => named(`rbac:permission(${permission})`, async (req: FastifyRequest) => {
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
    }),
  );

  // Enforce route-level `config.permission` declarations. Runs for every route
  // (root-level hook via fastify-plugin). Public routes carry no auth context,
  // so they are skipped; a public route must never declare a permission.
  const requireDeclared = new Map<PermissionKey, (req: FastifyRequest) => Promise<void>>();
  server.addHook(
    'preHandler',
    named('rbac:declared', async (req: FastifyRequest) => {
      const config = req.routeOptions.config as { permission?: PermissionKey; public?: boolean };
      const permission = config?.permission;
      if (!permission || config.public === true) return;
      let guard = requireDeclared.get(permission);
      if (!guard) {
        guard = server.requirePermission(permission);
        requireDeclared.set(permission, guard);
      }
      await guard(req);
    }),
  );

  server.decorate(
    'hasPermission',
    async (req: FastifyRequest, permission: PermissionKey): Promise<boolean> => {
      if (req.auth.role === 'api') {
        return apiKeyScopeSatisfiesPermission(req.auth.scopes, permission);
      }
      return userHasPermission(req.auth.orgId, req.auth.userId, permission);
    },
  );
});

export const rbacPlugin = plugin;
