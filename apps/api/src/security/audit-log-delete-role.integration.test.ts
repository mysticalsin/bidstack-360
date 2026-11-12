// WHY: the audit log is append-only for the application role. The table
// owner still deletes rows for retention and for test teardown. This proves
// the revoke, not a change of the user the API connects as.

import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import { beforeAll, describe, expect, it } from 'vitest';

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('audit log delete privilege', () => {
  t('the app role cannot delete an audit row and the table owner can', async () => {
    const org = await prisma.org.create({
      data: { clerkOrg: `org_audit_role_${randomUUID()}`, name: 'audit role' },
    });
    const row = await prisma.auditLog.create({
      data: { orgId: org.id, action: 'test.revoke-delete', targetType: 'test' },
    });
    try {
      const priv = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT has_table_privilege('app_role', 'public.audit_log', 'DELETE') AS allowed
      `;
      expect(priv[0]?.allowed).toBe(false);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE app_role');
          await tx.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}`;
        }),
      ).rejects.toThrow(/permission denied/);
      await prisma.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}`;
      expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).toBeNull();
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
