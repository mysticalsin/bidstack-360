/**
 * auth-helpers.ts — stateless helpers for the auth plugin.
 *
 * Extracted from auth.ts (BS-R1 file-size refactor).
 * Not part of the public API — imported only by auth.ts.
 */
import type { FastifyRequest } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateRbacDecisionCache } from '../lib/rbac-decision-cache.js';

/**
 * Maps a Clerk org role string to the internal role name used throughout the
 * application. Throws a typed sentinel string so the caller can detect and
 * audit-log unknown roles without catching generic Errors.
 */
export function mapClerkRole(orgRole: string | undefined): string {
  if (orgRole === undefined || orgRole === null) return 'member';
  const roleMap: Record<string, string> = {
    'org:admin': 'admin',
    'org:member': 'member',
    'org:manager': 'manager',
    'org:finance': 'finance',
  };
  const mapped = roleMap[orgRole];
  if (!mapped) {
    throw new Error(`UNRECOGNIZED_CLERK_ROLE:${orgRole}`);
  }
  return mapped;
}

/**
 * Idempotently assign the seeded `Admin` role to a user. Called on every
 * sign-in for users whose mapped Clerk role is `admin`, so the rbac plugin's
 * UserRole-based permission check always has something to find.
 *
 * If the org has no `Admin` row yet (fresh tenant that hasn't run the seed),
 * we log and skip — the operator will need to seed roles before admins can use
 * permission-gated endpoints. We do NOT auto-create the Role here because the
 * full Role row also requires its RolePermission mappings, which are managed
 * centrally in `packages/db/src/seed.ts`.
 */
export async function ensureAdminRoleGrant(
  userId: string,
  orgId: string,
  req: FastifyRequest,
): Promise<void> {
  const adminRole = await prisma.role.findFirst({
    where: { orgId, name: 'Admin', isSystem: true, deletedAt: null },
    select: { id: true },
  });
  if (!adminRole) {
    req.log.warn(
      { orgId, userId },
      'JIT admin grant skipped: org has no seeded Admin role (run pnpm db:seed)',
    );
    return;
  }
  // Revive a tombstoned grant FIRST: the soft-delete middleware scopes
  // upsert to live rows (deliberate — tombstones must not silently revive),
  // so without this a previously-revoked admin re-promoted in Clerk would
  // P2002 on the composite PK at sign-in. The explicit where.deletedAt is
  // the middleware's documented bypass for deliberate restores.
  await prisma.userRole.updateMany({
    where: { userId, roleId: adminRole.id, orgId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  // upsert on the composite PK so concurrent sign-ins don't race
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: adminRole.id } },
    create: { userId, roleId: adminRole.id, orgId },
    update: { deletedAt: null },
  });
  invalidateRbacDecisionCache(orgId, userId);
}
