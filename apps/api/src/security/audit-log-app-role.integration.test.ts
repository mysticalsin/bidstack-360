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

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function appRoleUrl(base: string, password: string): string {
  const url = new URL(base);
  url.username = 'app_role';
  url.password = password;
  return url.toString();
}

describe('audit log app role', () => {
  it('points the polo container at the app role and retention at the owner', () => {
    const wrangler = readFileSync(resolve(root, 'apps/polo-preview/wrangler.toml'), 'utf8');
    const passed = readFileSync(resolve(root, 'apps/polo-preview/src/container-env.js'), 'utf8');
    const entry = readFileSync(resolve(root, 'apps/polo-preview/container/entrypoint.mjs'), 'utf8');
    const bicep = readFileSync(resolve(root, 'infra/azure/main.bicep'), 'utf8');
    const migration = readFileSync(
      resolve(
        root,
        'packages/db/prisma/migrations/20261112180000_audit_log_app_role_runtime/migration.sql',
      ),
      'utf8',
    );

    // WHY: the live database is the container. The password is a Worker secret
    // name. Azure Key Vault is a draft and does not carry this login.
    expect(wrangler).toContain('POLO_APP_DB_PASSWORD');
    expect(wrangler).not.toMatch(/POLO_APP_DB_PASSWORD\s*=/);
    expect(passed).toContain("'POLO_APP_DB_PASSWORD'");
    expect(entry).toContain('env: migrateEnv()');
    expect(entry).toContain('delete env.DATABASE_URL_OWNER');
    expect(entry).toContain('DATABASE_URL_OWNER: OWNER_URL');
    expect(entry).toContain('could not set the app role password');
    expect(bicep).not.toContain('database-url-app-api');
    expect(bicep).not.toContain('pgAppPassword');
    expect(migration).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM app_role');
    expect(migration).not.toMatch(/PASSWORD\s+'/i);
  });

  it('the app role cannot delete or truncate an audit row and retention still can', async (ctx) => {
    if (!dbReachable) throw new Error('[skip] app role — DATABASE_URL not reachable');
    const base = process.env.DATABASE_URL;
    if (!base) throw new Error('[skip] app role — DATABASE_URL not reachable');
    // The test environment supplies a test-only value. This test does not
    // invent or read a live secret. Without that value, scram rejects an
    // empty password, so the check is skipped with that reason.
    const password = process.env.APP_ROLE_TEST_PASSWORD;
    if (!password) {
      ctx.skip(
        'scram rejects an empty password; set APP_ROLE_TEST_PASSWORD to a test-only value',
      );
      return;
    }

    const org = await prisma.org.create({
      data: { clerkOrg: `org_app_role_${randomUUID()}`, name: 'app role' },
    });
    const row = await prisma.auditLog.create({
      data: { orgId: org.id, action: 'test.app-role', targetType: 'test' },
    });
    await prisma.$executeRawUnsafe(`ALTER ROLE app_role PASSWORD ${quoteLiteral(password)}`);
    const app = new PrismaClient({ datasources: { db: { url: appRoleUrl(base, password) } } });
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
