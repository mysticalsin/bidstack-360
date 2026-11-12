// WHY: the preparatory revoke never became the connection the API uses.
// app_role had no login, so the process still deleted audit rows as the
// table owner. This proves the app login cannot delete or truncate an audit
// row, and the retention connection still can.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { PrismaClient, prisma } from '@bidstack/db';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

function appRoleUrl(base: string): string {
  const url = new URL(base);
  url.username = 'app_role';
  url.password = '';
  return url.toString();
}

describe('audit log app role', () => {
  it('points the api and worker at the app role and retention at the owner', () => {
    const bicep = readFileSync(resolve(root, 'infra/azure/main.bicep'), 'utf8');
    const migrate = readFileSync(resolve(root, 'scripts/run-safe-migrate-deploy.mjs'), 'utf8');
    const migration = readFileSync(
      resolve(
        root,
        'packages/db/prisma/migrations/20261112180000_audit_log_app_role_runtime/migration.sql',
      ),
      'utf8',
    );

    // The Key Vault secret is a reference. The password stays a secure
    // parameter and is not written into the template as a literal.
    expect(bicep).toContain("'database-url-app-api'");
    expect(bicep).toContain("'database-url-app-worker'");
    expect(bicep).toContain("secretRef: 'database-url-app-api'");
    expect(bicep).toContain("name: 'DATABASE_URL_APP'");
    expect(bicep).toContain("secretRef: 'database-url-direct'");
    expect(bicep).toContain("name: 'DATABASE_URL_OWNER'");
    expect(bicep.match(/resource kv 'Microsoft\.KeyVault\/vaults@/g)).toHaveLength(1);
    expect(migration).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM app_role');
    expect(migration).not.toMatch(/PASSWORD\s+'/i);
    expect(migrate).toContain('DATABASE_URL_OWNER is required');
    expect(migrate).toContain('could not set the app role password');
  });

  it('the app role cannot delete or truncate an audit row and retention still can', async () => {
    if (!dbReachable) throw new Error('[skip] app role — DATABASE_URL not reachable');
    const base = process.env.DATABASE_URL;
    if (!base) throw new Error('[skip] app role — DATABASE_URL not reachable');

    const org = await prisma.org.create({
      data: { clerkOrg: `org_app_role_${randomUUID()}`, name: 'app role' },
    });
    const row = await prisma.auditLog.create({
      data: { orgId: org.id, action: 'test.app-role', targetType: 'test' },
    });
    const app = new PrismaClient({ datasources: { db: { url: appRoleUrl(base) } } });
    try {
      const who = await app.$queryRaw<Array<{ user: string }>>`SELECT current_user AS user`;
      expect(who[0]?.user).toBe('app_role');

      const priv = await app.$queryRaw<Array<{ can_delete: boolean; can_truncate: boolean }>>`
        SELECT has_table_privilege('app_role', 'public.audit_log', 'DELETE') AS can_delete,
               has_table_privilege('app_role', 'public.audit_log', 'TRUNCATE') AS can_truncate
      `;
      expect(priv[0]?.can_delete).toBe(false);
      expect(priv[0]?.can_truncate).toBe(false);

      await expect(
        app.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}`,
      ).rejects.toThrow(/permission denied/);
      await expect(app.$executeRaw`TRUNCATE TABLE audit_log`).rejects.toThrow(/permission denied/);

      const { deleteAuditRowsAsRetention } = await import('@bidstack/db');
      expect(await deleteAuditRowsAsRetention([row.id])).toBe(1);
      expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).toBeNull();
    } finally {
      await app.$disconnect().catch(() => undefined);
      const { closeRetentionPrisma } = await import('@bidstack/db');
      await closeRetentionPrisma().catch(() => undefined);
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
