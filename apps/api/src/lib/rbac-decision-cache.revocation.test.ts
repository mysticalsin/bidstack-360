// Revoking a role must actually revoke it.
//
// WHY THIS TEST EXISTS: role revocation is a SOFT DELETE on the assignment row —
// `DELETE /users/:id/roles/:roleId` sets `UserRole.deletedAt` (routes/users.ts).
// Both decision queries here filtered `user.deletedAt` and `role.deletedAt` but
// not the assignment's own tombstone, so a revoked user kept every role and
// every permission it carried. The audit log recorded the revoke and the users
// list stopped showing it, which is exactly what makes that class of bug
// survive: everything the operator can see says the access is gone.
//
// These assertions are on the WHERE CLAUSE rather than on a boolean, because the
// boolean is whatever the mock returns. The defect was an absent filter, so the
// filter is what has to be pinned. `sibling` rbac.service.ts already got this
// right — this is the second RBAC path catching up.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: { userRole: { count: vi.fn() } },
}));

import { prisma } from '@bidstack/db';

import {
  clearRbacDecisionCacheForTest,
  userHasAnyRole,
  userHasPermission,
} from './rbac-decision-cache.js';

const userRoleCount = vi.mocked(prisma.userRole.count);

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  clearRbacDecisionCacheForTest();
  userRoleCount.mockReset();
  userRoleCount.mockResolvedValue(0);
});

describe('rbac decision queries exclude revoked assignments', () => {
  it('userHasAnyRole ignores soft-deleted role assignments', async () => {
    await userHasAnyRole(ORG, USER, ['Admin']);

    const where = userRoleCount.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    // The assignment row's own tombstone — the filter that was missing.
    expect(where.deletedAt).toBeNull();
    // The pre-existing filters must survive alongside it.
    expect(where.user).toMatchObject({ orgId: ORG, deletedAt: null });
    expect(where.role).toMatchObject({ orgId: ORG, deletedAt: null });
  });

  it('userHasPermission ignores soft-deleted role assignments', async () => {
    await userHasPermission(ORG, USER, 'reports:write');

    const where = userRoleCount.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.deletedAt).toBeNull();
  });

  it('userHasPermission ignores soft-deleted role→permission grants', async () => {
    // Revoking ONE permission from a role is the same class of no-op: the grant
    // row is soft-deleted, so `some` has to exclude tombstones too.
    await userHasPermission(ORG, USER, 'reports:write');

    const where = userRoleCount.mock.calls[0]?.[0]?.where as {
      role?: { permissions?: { some?: Record<string, unknown> } };
    };
    const some = where.role?.permissions?.some;
    expect(some).toBeDefined();
    expect(some?.deletedAt).toBeNull();
    expect(some?.permission).toMatchObject({ key: 'reports:write' });
  });
});
