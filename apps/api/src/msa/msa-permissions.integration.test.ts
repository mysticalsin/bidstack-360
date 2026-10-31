/**
 * MSA library permissions (2026-10-31).
 *
 * msa:read / msa:write / msa:admin are seeded on new orgs, and migration
 * 20261031200000_msa_library grants them to existing orgs so nobody loses
 * access to contract data they already reach through accounts:read/write.
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
  '../../../../packages/db/prisma/migrations/20261031200000_msa_library/migration.sql',
);

let orgId: string | null = null;

beforeAll(async () => {
  const org = await createIsolatedOrg('msa-perms');
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
  return rows.map((r) => r.permission.key).filter((k) => k.startsWith('msa:')).sort();
}

describe('msa permission keys', () => {
  it('are canonical keys', () => {
    for (const key of ['msa:read', 'msa:write', 'msa:admin']) {
      expect(PERMISSION_KEYS).toContain(key);
    }
  });

  it('matrix: admin-only msa:admin, SDR read-only', () => {
    expect(RBAC_MATRIX.Admin).toContain('msa:admin');
    for (const role of Object.keys(RBAC_MATRIX) as Array<keyof typeof RBAC_MATRIX>) {
      if (role !== 'Admin') expect(RBAC_MATRIX[role]).not.toContain('msa:admin');
    }
    expect(RBAC_MATRIX.SDR).toContain('msa:read');
    expect(RBAC_MATRIX.SDR).not.toContain('msa:write');
    expect(RBAC_MATRIX['Account Executive']).toEqual(
      expect.arrayContaining(['msa:read', 'msa:write']),
    );
  });
});

describe('seeded org grants', () => {
  it.each([
    ['Admin', ['msa:admin', 'msa:read', 'msa:write']],
    ['Account Executive', ['msa:read', 'msa:write']],
    ['Customer Success', ['msa:read', 'msa:write']],
    ['Sales Manager', ['msa:read', 'msa:write']],
    ['SDR', ['msa:read']],
    ['Read-Only', ['msa:read']],
  ])('%s', async (role, expected) => {
    expect(await grants(role)).toEqual(expected);
  });

  it('every seeded role with accounts:read also has msa:read (and write likewise)', async () => {
    const roles = await prisma.role.findMany({
      where: { orgId: orgId!, deletedAt: null },
      select: {
        name: true,
        permissions: { where: { deletedAt: null }, select: { permission: { select: { key: true } } } },
      },
      take: 100,
    });
    for (const r of roles) {
      const keys = new Set(r.permissions.map((p) => p.permission.key));
      if (keys.has('accounts:read')) expect(keys.has('msa:read'), r.name).toBe(true);
      if (keys.has('accounts:write')) expect(keys.has('msa:write'), r.name).toBe(true);
    }
  });
});

describe('migration grant backfill', () => {
  it('grants msa keys to a custom role from accounts keys and never revives a revoked grant', async () => {
    const accountsRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'accounts:read' } });
    const accountsWrite = await prisma.permission.findUniqueOrThrow({ where: { key: 'accounts:write' } });
    const msaRead = await prisma.permission.findUniqueOrThrow({ where: { key: 'msa:read' } });
    const custom = await prisma.role.create({
      data: { orgId: orgId!, name: 'MSA custom', description: 'test', isSystem: false },
    });
    const revoked = await prisma.role.create({
      data: { orgId: orgId!, name: 'MSA revoked', description: 'test', isSystem: false },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: custom.id, permissionId: accountsRead.id, orgId: orgId! },
        { roleId: custom.id, permissionId: accountsWrite.id, orgId: orgId! },
        { roleId: revoked.id, permissionId: accountsRead.id, orgId: orgId! },
        { roleId: revoked.id, permissionId: msaRead.id, orgId: orgId!, deletedAt: new Date() },
      ],
    });

    // Re-run only the grant backfill statement from the migration file.
    const sql = readFileSync(MIGRATION, 'utf8');
    const start = sql.indexOf('INSERT INTO "role_permissions"');
    const end = sql.indexOf('ON CONFLICT ("role_id", "permission_id") DO NOTHING;', start);
    expect(start).toBeGreaterThan(0);
    await prisma.$executeRawUnsafe(
      sql.slice(start, end + 'ON CONFLICT ("role_id", "permission_id") DO NOTHING;'.length),
    );

    expect(await grants('MSA custom')).toEqual(['msa:read', 'msa:write']);
    expect(await grants('MSA revoked')).toEqual([]);
  });
});
