/**
 * Meeting intel permissions (2026-10-31).
 *
 * meetings:read / meetings:write are seeded on new orgs wherever kam:read /
 * kam:write are, and migration 20261031220000_meeting_intel backfills existing
 * roles the same way without reviving a revoked grant.
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
  '../../../../packages/db/prisma/migrations/20261031220000_meeting_intel/migration.sql',
);

let orgId: string | null = null;

beforeAll(async () => {
  const org = await createIsolatedOrg('meeting-perms');
  orgId = org.orgId;
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
  return rows.map((r) => r.permission.key).filter((k) => k.startsWith('meetings:')).sort();
}

describe('meetings permission keys', () => {
  it('are canonical keys', () => {
    for (const key of ['meetings:read', 'meetings:write']) expect(PERMISSION_KEYS).toContain(key);
  });

  it('matrix follows kam on every role', () => {
    for (const role of Object.keys(RBAC_MATRIX) as Array<keyof typeof RBAC_MATRIX>) {
      const keys = RBAC_MATRIX[role];
      // Account Executive reads meetings without kam:read (approved 2026-10-31).
      const aeRead = role === 'Account Executive';
      expect(keys.includes('meetings:read'), role).toBe(aeRead || keys.includes('kam:read'));
      expect(keys.includes('meetings:write'), role).toBe(keys.includes('kam:write'));
    }
    expect(RBAC_MATRIX['Account Executive']).toContain('meetings:read');
  });
});

describe('seeded org grants', () => {
  it('every seeded role has meetings keys exactly where it has kam keys', async () => {
    const roles = await prisma.role.findMany({
      where: { orgId: orgId!, deletedAt: null },
      select: {
        name: true,
        permissions: { where: { deletedAt: null }, select: { permission: { select: { key: true } } } },
      },
      take: 100,
    });
    expect(roles.length).toBeGreaterThan(3);
    for (const r of roles) {
      const keys = new Set(r.permissions.map((p) => p.permission.key));
      expect(keys.has('meetings:read'), r.name).toBe(r.name === 'Account Executive' || keys.has('kam:read'));
      expect(keys.has('meetings:write'), r.name).toBe(keys.has('kam:write'));
    }
    expect(await grants('Admin')).toEqual(['meetings:read', 'meetings:write']);
  });
});

describe('migration grant backfill', () => {
  it('grants meetings keys to a custom role from kam keys and never revives a revoked grant', async () => {
    const kamRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'kam:read' } });
    const kamWrite = await prisma.permission.findUniqueOrThrow({ where: { key: 'kam:write' } });
    const mRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'meetings:read' } });
    const custom = await prisma.role.create({
      data: { orgId: orgId!, name: 'Meetings custom', description: 'test', isSystem: false },
    });
    const revoked = await prisma.role.create({
      data: { orgId: orgId!, name: 'Meetings revoked', description: 'test', isSystem: false },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: custom.id, permissionId: kamRead.id, orgId: orgId! },
        { roleId: custom.id, permissionId: kamWrite.id, orgId: orgId! },
        { roleId: revoked.id, permissionId: kamRead.id, orgId: orgId! },
        { roleId: revoked.id, permissionId: mRead.id, orgId: orgId!, deletedAt: new Date() },
      ],
    });

    const sql = readFileSync(MIGRATION, 'utf8');
    const start = sql.indexOf('INSERT INTO "role_permissions"');
    const end = sql.indexOf('ON CONFLICT ("role_id", "permission_id") DO NOTHING;', start);
    expect(start).toBeGreaterThan(0);
    await prisma.$executeRawUnsafe(
      sql.slice(start, end + 'ON CONFLICT ("role_id", "permission_id") DO NOTHING;'.length),
    );

    expect(await grants('Meetings custom')).toEqual(['meetings:read', 'meetings:write']);
    expect(await grants('Meetings revoked')).toEqual([]);
  });
});

describe('20261031230000_ae_meetings_read', () => {
  const AE_MIGRATION = MIGRATION.replace('20261031220000_meeting_intel', '20261031230000_ae_meetings_read');

  it('grants meetings:read to system Account Executive roles only, never reviving a revoked grant', async () => {
    const mRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'meetings:read' } });
    const ae = await prisma.role.findFirstOrThrow({ where: { orgId: orgId!, name: 'Account Executive', isSystem: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ae.id, permissionId: mRead.id } });
    const customAe = await prisma.role.create({
      data: { orgId: orgId!, name: 'AE custom copy', description: 'test', isSystem: false },
    });
    const sql = readFileSync(AE_MIGRATION, 'utf8');
    await prisma.$executeRawUnsafe(sql);
    expect(await grants('Account Executive')).toContain('meetings:read');
    expect(await grants('AE custom copy')).toEqual([]);
    // Idempotent, and an explicit revocation (soft delete) stays revoked.
    await prisma.rolePermission.updateMany({ where: { roleId: ae.id, permissionId: mRead.id }, data: { deletedAt: new Date() } });
    await prisma.$executeRawUnsafe(sql);
    expect(await grants('Account Executive')).not.toContain('meetings:read');
    await prisma.rolePermission.updateMany({
      where: { roleId: ae.id, permissionId: mRead.id, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    expect(await grants('Account Executive')).toContain('meetings:read');
    await prisma.role.delete({ where: { id: customAe.id } });
  });
});
