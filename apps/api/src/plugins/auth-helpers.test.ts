import { describe, it, expect, beforeEach, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { ensureAdminRoleGrant } from './auth-helpers.js';

vi.mock('@bidstack/db', () => ({
  prisma: {
    role: { findFirst: vi.fn() },
    userRole: { updateMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('../lib/rbac-decision-cache.js', () => ({
  invalidateRbacDecisionCache: vi.fn(),
}));

const mockedRoleFindFirst = vi.mocked(prisma.role.findFirst);
const mockedUpdateMany = vi.mocked(prisma.userRole.updateMany);
const mockedUpsert = vi.mocked(prisma.userRole.upsert);

function fakeReq() {
  return { log: { warn: vi.fn() } } as never;
}

describe('ensureAdminRoleGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revives a tombstoned grant BEFORE the upsert (soft-delete middleware bypass)', async () => {
    // WHY: the soft-delete middleware scopes upsert to live rows, so without
    // the explicit-deletedAt revive, a previously-revoked admin re-promoted
    // in Clerk would P2002 on the composite PK during sign-in.
    mockedRoleFindFirst.mockResolvedValue({ id: 'role-admin' } as never);
    mockedUpdateMany.mockResolvedValue({ count: 1 } as never);
    mockedUpsert.mockResolvedValue({} as never);

    await ensureAdminRoleGrant('user-1', 'org-1', fakeReq());

    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', roleId: 'role-admin', orgId: 'org-1', deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    expect(mockedUpsert).toHaveBeenCalledOnce();
    // Revive must run first — the upsert only sees the live row after it.
    expect(mockedUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockedUpsert.mock.invocationCallOrder[0],
    );
  });

  it('skips the grant with a warning when the org has no seeded Admin role', async () => {
    mockedRoleFindFirst.mockResolvedValue(null);
    const req = fakeReq();

    await ensureAdminRoleGrant('user-1', 'org-1', req);

    expect(mockedUpdateMany).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect((req as { log: { warn: ReturnType<typeof vi.fn> } }).log.warn).toHaveBeenCalled();
  });
});
