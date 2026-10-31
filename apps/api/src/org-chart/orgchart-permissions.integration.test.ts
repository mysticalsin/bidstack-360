/**
 * Org chart permissions (Tony Walteur, 2026-10-31 18:57 BRT).
 *
 * orgchart:read follows companies:read on every role; orgchart:write is
 * Admin-only. Seeded orgs get it from seed.rbac.ts, existing orgs from
 * migration 20261031234000_orgchart_permissions, which never revives a
 * revoked grant.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import { PERMISSION_KEYS, RBAC_MATRIX } from '@bidstack/shared';

import { createIsolatedOrg, dropIsolatedOrg } from '../test-support/isolated-org.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(
  here,
  '../../../../packages/db/prisma/migrations/20261031234000_orgchart_permissions/migration.sql',
);

let orgId: string | null = null;

beforeAll(async () => {
  orgId = (await createIsolatedOrg('orgchart-perms')).orgId;
});

afterAll(async () => {
  if (orgId) await dropIsolatedOrg(orgId);
});

async function grants(roleName: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { orgId: orgId!, deletedAt: null, role: { name: roleName } },
    select: { permission: { select: { key: true } } },
    take: 500,
  });
  return rows.map((r) => r.permission.key).filter((k) => k.startsWith('orgchart:')).sort();
}

/** Run the migration statement by statement (comments stripped). */
async function runMigration(): Promise<void> {
  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('--'))
    .join('\n');
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(stmt);
  }
}

describe('orgchart permission keys', () => {
  it('are canonical keys', () => {
    for (const key of ['orgchart:read', 'orgchart:write']) expect(PERMISSION_KEYS).toContain(key);
  });

  it('matrix: read follows companies:read, write is Admin only', () => {
    for (const role of Object.keys(RBAC_MATRIX) as Array<keyof typeof RBAC_MATRIX>) {
      const keys = RBAC_MATRIX[role];
      expect(keys.includes('orgchart:read'), role).toBe(keys.includes('companies:read'));
      expect(keys.includes('orgchart:write'), role).toBe(role === 'Admin');
    }
  });
});

describe('seeded org grants', () => {
  it('every seeded role reads org charts exactly where it reads companies; only Admin writes', async () => {
    const roles = await prisma.role.findMany({
      where: { orgId: orgId!, deletedAt: null },
      select: { name: true, permissions: { where: { deletedAt: null }, select: { permission: { select: { key: true } } } } },
      take: 100,
    });
    expect(roles.length).toBeGreaterThan(3);
    for (const r of roles) {
      const keys = new Set(r.permissions.map((p) => p.permission.key));
      expect(keys.has('orgchart:read'), r.name).toBe(keys.has('companies:read'));
      expect(keys.has('orgchart:write'), r.name).toBe(r.name === 'Admin');
    }
    expect(await grants('Admin')).toEqual(['orgchart:read', 'orgchart:write']);
    expect(await grants('Read-Only')).toEqual(['orgchart:read']);
  });
});

describe('20261031234000_orgchart_permissions backfill', () => {
  it('derives read from companies:read on custom roles, write on system Admin only, idempotent, never revives a revoked grant', async () => {
    const compRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'companies:read' } });
    const ocRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'orgchart:read' } });
    const ocWrite = await prisma.permission.findUniqueOrThrow({ where: { key: 'orgchart:write' } });
    const admin = await prisma.role.findFirstOrThrow({ where: { orgId: orgId!, name: 'Admin', isSystem: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: admin.id, permissionId: { in: [ocRead.id, ocWrite.id] } } });
    const custom = await prisma.role.create({ data: { orgId: orgId!, name: 'OC custom', description: 'test', isSystem: false } });
    const revoked = await prisma.role.create({ data: { orgId: orgId!, name: 'OC revoked', description: 'test', isSystem: false } });
    const fakeAdmin = await prisma.role.create({ data: { orgId: orgId!, name: 'OC no companies', description: 'test', isSystem: false } });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: custom.id, permissionId: compRead.id, orgId: orgId! },
        { roleId: revoked.id, permissionId: compRead.id, orgId: orgId! },
        { roleId: revoked.id, permissionId: ocRead.id, orgId: orgId!, deletedAt: new Date() },
      ],
    });
    await runMigration();
    await runMigration();
    expect(await grants('Admin')).toEqual(['orgchart:read', 'orgchart:write']);
    expect(await grants('OC custom')).toEqual(['orgchart:read']);
    expect(await grants('OC revoked')).toEqual([]);
    expect(await grants('OC no companies')).toEqual([]);
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [custom.id, revoked.id, fakeAdmin.id] } } });
    await prisma.role.deleteMany({ where: { id: { in: [custom.id, revoked.id, fakeAdmin.id] } } });
  });
});
