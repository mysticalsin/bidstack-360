// RBAC service — per-request permission cache + helpers.
//
// Why a service on top of the plugin (apps/api/src/plugins/rbac.ts)?
// The plugin decorates Fastify with quick preHandler helpers. This service
// provides:
//   1. `hasPermission` — boolean check for conditional logic inside handlers
//   2. `getUserPermissions` — full permission set for a user (e.g., to build
//      a capability manifest sent to the frontend)
//   3. Request-scoped caching via WeakMap so the same user's permissions are
//      only fetched once per request even if multiple checks are made.
//
// The 6 canonical spec roles are defined here as constants so callers can
// reference them without coupling to raw name strings.

import type { FastifyRequest } from 'fastify';
import { prisma } from '@bidstack/db';
import type { PermissionKey } from '@bidstack/shared';

// ─── Canonical role names ────────────────────────────────────────────────────

/** The 6 system roles defined in the Polo PreSales spec and seeded at boot. */
export const SYSTEM_ROLES = {
  ADMIN: 'Admin',
  SALES_MANAGER: 'Sales Manager',
  ACCOUNT_EXECUTIVE: 'Account Executive',
  SDR: 'SDR',
  CUSTOMER_SUCCESS: 'Customer Success',
  READ_ONLY: 'Read-Only',
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

// ─── Per-request cache ───────────────────────────────────────────────────────

// WeakMap keyed on the request object so entries are GC'd with the request.
const permCache = new WeakMap<FastifyRequest, Set<string>>();

async function loadUserPermissions(req: FastifyRequest): Promise<Set<string>> {
  const cached = permCache.get(req);
  if (cached) return cached;

  const rows = await prisma.userRole.findMany({
    where: {
      userId: req.auth.userId,
      orgId: req.auth.orgId,
      deletedAt: null,
      role: { orgId: req.auth.orgId, deletedAt: null },
    },
    select: {
      role: {
        select: {
          permissions: {
            where: { deletedAt: null },
            select: { permission: { select: { key: true } } },
          },
        },
      },
    },
    // No user holds anywhere near this many roles; the bound satisfies the
    // dev query-guard (this path is now reachable via GET /me/capabilities).
    take: 200,
  });

  const perms = new Set<string>();
  for (const ur of rows) {
    for (const rp of ur.role.permissions) {
      perms.add(rp.permission.key);
    }
  }

  permCache.set(req, perms);
  return perms;
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/**
 * Boolean permission check — does not throw. Use when you need conditional
 * behaviour inside a route handler (e.g., to include/exclude a field).
 */
export async function hasPermission(
  req: FastifyRequest,
  permission: PermissionKey,
): Promise<boolean> {
  const perms = await loadUserPermissions(req);
  return perms.has(permission);
}

/**
 * Fastify preHandler / onRequest hook — throws 403 if the caller lacks the
 * given permission. Wire in as:
 *
 *   server.get('/resource', { preHandler: requirePermission('leads:write') }, handler)
 */
export function requirePermission(
  permission: PermissionKey,
): (req: FastifyRequest) => Promise<void> {
  return async (req) => {
    const perms = await loadUserPermissions(req);
    if (perms.has(permission)) return;
    throw req.server.httpErrors.forbidden(`Requires permission: ${permission}`);
  };
}

/**
 * Returns all permission keys held by the current user.
 * Used to build the capability manifest sent to the frontend on session load.
 */
export async function getUserPermissions(req: FastifyRequest): Promise<string[]> {
  const perms = await loadUserPermissions(req);
  return Array.from(perms).sort();
}

/**
 * Check whether the user holds at least one of the given role names in the
 * current org. Prefer `requirePermission` for guard logic — this is useful
 * when a route needs to vary behaviour based on role (e.g., admin-only fields).
 */
export async function hasRole(req: FastifyRequest, ...roleNames: string[]): Promise<boolean> {
  const nameSet = new Set(roleNames);
  const count = await prisma.userRole.count({
    where: {
      userId: req.auth.userId,
      orgId: req.auth.orgId,
      deletedAt: null,
      role: {
        orgId: req.auth.orgId,
        name: { in: Array.from(nameSet) },
        deletedAt: null,
      },
    },
  });
  return count > 0;
}
