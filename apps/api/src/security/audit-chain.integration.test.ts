/**
 * Append-only, hash-chained audit log.
 *
 * Every insert is chained per org by a DB trigger; content updates and
 * TRUNCATE are rejected; verification detects a rewritten row (hash), a
 * removed middle row (sequence gap) and stays scoped to one tenant.
 */
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyAuditChain } from '../lib/audit-chain.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId = '';
let otherOrgId = '';
let restoreAuth: (() => void) | null = null;

async function write(org: string, n: number, label: string) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push(
      await prisma.auditLog.create({
        data: { orgId: org, action: `test.chain.${label}`, targetType: 'test', targetId: String(i), diff: { i } },
      }),
    );
  }
  return rows;
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const org = await createIsolatedOrg('audit-chain');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  otherOrgId = (
    await prisma.org.create({ data: { clerkOrg: `org_chain_${randomUUID()}`, name: 'Chain Other Org' } })
  ).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
  if (orgId) await dropIsolatedOrg(orgId);
});

describe('audit log hash chain', () => {
  it('chains each insert to the previous row of the same org', async () => {
    const rows = await write(orgId, 3, 'link');
    for (const r of rows) {
      expect(r.chainSeq).not.toBeNull();
      expect(r.rowHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(rows[1]!.prevHash).toBe(rows[0]!.rowHash);
    expect(rows[2]!.prevHash).toBe(rows[1]!.rowHash);
    expect(rows[2]!.chainSeq! - rows[0]!.chainSeq!).toBe(2n);
  });

  it('ignores chain values supplied by the application', async () => {
    const row = await prisma.auditLog.create({
      data: {
        orgId,
        action: 'test.chain.forged',
        chainSeq: 999_999n,
        prevHash: 'f'.repeat(64),
        rowHash: 'e'.repeat(64),
      },
    });
    expect(row.chainSeq).not.toBe(999_999n);
    expect(row.rowHash).not.toBe('e'.repeat(64));
  });

  it('keeps one contiguous chain under concurrent writers', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        prisma.auditLog.create({ data: { orgId: otherOrgId, action: 'test.chain.concurrent', targetId: String(i) } }),
      ),
    );
    const report = await verifyAuditChain(otherOrgId);
    expect(report).toMatchObject({ checked: 25, firstSeq: '1', lastSeq: '25', ok: true });
  });

  it('verification passes for an untouched chain and is scoped to one org', async () => {
    const report = await verifyAuditChain(orgId);
    expect(report.ok).toBe(true);
    const own = await prisma.auditLog.count({ where: { orgId, chainSeq: { not: null } } });
    expect(report.checked).toBe(own);
  });

  it('rejects content updates but allows soft delete', async () => {
    const [row] = await write(orgId, 1, 'immutable');
    await expect(
      prisma.auditLog.update({ where: { id: row!.id }, data: { diff: { rewritten: true } } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.auditLog.update({ where: { id: row!.id }, data: { action: 'test.chain.renamed' } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.auditLog.update({ where: { id: row!.id }, data: { deletedAt: new Date() } }),
    ).resolves.toBeTruthy();
  });

  it('rejects TRUNCATE', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('TRUNCATE TABLE audit_log');
        throw new Error('truncate was not blocked; rolled back');
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('GET /audit-logs/verify-chain reports the caller org chain', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/audit-logs/verify-chain' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, breaks: [] });
  });

  it('detects a rewritten row and a removed middle row', async () => {
    const rows = await write(otherOrgId, 3, 'tamper');
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only'),
      prisma.$executeRaw`UPDATE audit_log SET diff = '{"forged":true}'::jsonb WHERE id = ${rows[0]!.id}`,
      prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only'),
    ]);
    await prisma.auditLog.delete({ where: { id: rows[1]!.id } });

    const report = await verifyAuditChain(otherOrgId);
    expect(report.ok).toBe(false);
    expect(report.breaks).toEqual([
      { id: rows[0]!.id.toString(), chainSeq: rows[0]!.chainSeq!.toString(), reason: 'hash_mismatch' },
      { id: rows[2]!.id.toString(), chainSeq: rows[2]!.chainSeq!.toString(), reason: 'link_mismatch' },
    ]);
    expect((await verifyAuditChain(orgId)).ok).toBe(true);
  });

  // A NULL digest made the integrity predicate NULL, so the row dropped out of
  // the break list and the next row's NULL lag(row_hash) passed the link check.
  it('detects a row whose digest was cleared', async () => {
    const nullOrg = (
      await prisma.org.create({ data: { clerkOrg: `org_chain_null_${randomUUID()}`, name: 'Chain Null Org' } })
    ).id;
    try {
      const rows = await write(nullOrg, 3, 'cleared');
      await prisma.$transaction([
        prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only'),
        prisma.$executeRaw`UPDATE audit_log SET row_hash = NULL WHERE id = ${rows[1]!.id}`,
        prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only'),
      ]);
      const report = await verifyAuditChain(nullOrg);
      expect(report.ok).toBe(false);
      expect(report.breaks).toEqual([
        { id: rows[1]!.id.toString(), chainSeq: rows[1]!.chainSeq!.toString(), reason: 'hash_mismatch' },
        { id: rows[2]!.id.toString(), chainSeq: rows[2]!.chainSeq!.toString(), reason: 'link_mismatch' },
      ]);
    } finally {
      await prisma.org.deleteMany({ where: { id: nullOrg } });
    }
  });
});
