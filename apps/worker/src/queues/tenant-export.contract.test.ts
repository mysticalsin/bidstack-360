// Contract test for the GDPR Art. 20 tenant-export job handler.
// Pattern: document-extract.contract.test.ts — real DB + a temp local storage
// root (STORAGE_DRIVER=local), throwaway org fixtures cleaned up in afterAll.
//
// WHY these assertions matter:
//   - the job must PAGE org-scoped data and write it as gzipped NDJSON (the
//     deliverable a data subject's org receives under Art. 20);
//   - on success the TenantExport row must reach `ready` with key + sizeBytes;
//   - REDELIVERY must be idempotent (a completed export is not re-run);
//   - SECRET fields must never be in the export (the registry's whole point).
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prisma } from '@bidstack/db';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processTenantExportJob, exportStorageKey } from './tenant-export.js';
import { safeSelectForModel } from '../lib/tenant-export-registry.js';

const log = pino({ level: 'silent' });

let dbReachable = false;
let orgId: string | null = null;
let exportId: string | null = null;
let storageRoot: string | null = null;
let previousDriver: string | undefined;
let previousRoot: string | undefined;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  previousDriver = process.env.STORAGE_DRIVER;
  previousRoot = process.env.LOCAL_STORAGE_ROOT;
  process.env.STORAGE_DRIVER = 'local';
  storageRoot = path.join(tmpdir(), `bidstack-export-test-${Date.now()}-${Math.random()}`);
  process.env.LOCAL_STORAGE_ROOT = storageRoot;

  const org = await prisma.org.create({
    data: { name: 'Export Test Org', clerkOrg: `org_export_test_${Date.now()}` },
  });
  orgId = org.id;
  const requester = await prisma.user.create({
    data: {
      orgId,
      clerkUser: `u_export_test_${Date.now()}`,
      email: `export-admin-${Date.now()}@export.test`,
      name: 'Export Admin',
      role: 'admin',
    },
  });
  // Two companies so the export has multiple entities + rows to page.
  await prisma.company.createMany({
    data: [
      { orgId, name: 'Acme Export Co' },
      { orgId, name: 'Beta Export Co' },
    ],
  });

  const exp = await prisma.tenantExport.create({
    data: { orgId, requestedById: requester.id, status: 'pending' },
  });
  exportId = exp.id;
});

afterAll(async () => {
  if (orgId) {
    await prisma.tenantExport.deleteMany({ where: { orgId } });
    await prisma.company.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.org.deleteMany({ where: { id: orgId } });
  }
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true }).catch(() => undefined);
  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
  if (previousRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
  else process.env.LOCAL_STORAGE_ROOT = previousRoot;
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !exportId) {
      throw new Error(`[skip] ${name} — DB/fixtures unavailable`);
    }
    await fn();
  });

function readArchiveRecords(): Array<Record<string, unknown>> {
  const key = exportStorageKey(orgId!, exportId!);
  const file = path.resolve(storageRoot!, key);
  const text = gunzipSync(readFileSync(file)).toString('utf-8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('tenant-export job handler', () => {
  t('processes the job → ready row + gzipped NDJSON archive with paged data', async () => {
    await processTenantExportJob({ data: { exportId, orgId } }, log);

    const row = await prisma.tenantExport.findUnique({ where: { id: exportId! } });
    expect(row?.status).toBe('ready');
    expect(row?.storageKey).toBe(exportStorageKey(orgId!, exportId!));
    expect(row?.sizeBytes).not.toBeNull();
    expect(Number(row?.sizeBytes ?? 0)).toBeGreaterThan(0);
    expect(row?.completedAt).not.toBeNull();
    expect(row?.expiresAt).not.toBeNull();

    const records = readArchiveRecords();
    // Manifest first, then the org + the two companies.
    expect(records[0]?._entity).toBe('_manifest');
    const companies = records.filter((r) => r._entity === 'companies');
    expect(companies).toHaveLength(2);
    expect(companies.map((c) => c.name).sort()).toEqual(['Acme Export Co', 'Beta Export Co']);
    expect(records.some((r) => r._entity === 'org' && r.id === orgId)).toBe(true);
  });

  t('redelivery is idempotent — a ready export is not re-run', async () => {
    const before = await prisma.tenantExport.findUnique({ where: { id: exportId! } });
    await processTenantExportJob({ data: { exportId, orgId } }, log);
    const after = await prisma.tenantExport.findUnique({ where: { id: exportId! } });
    // The claim updateMany only matches pending|running, so a ready row is
    // untouched: same completedAt, no second run.
    expect(after?.status).toBe('ready');
    expect(after?.completedAt?.toISOString()).toBe(before?.completedAt?.toISOString());
  });

  t('secret fields are excluded from every exported entity select', () => {
    // The User model carries no secret scalars but Contact/Company are the data
    // subjects' records; assert the denylist actually drops secret-shaped names.
    for (const model of ['Org', 'User', 'Company', 'Contact', 'FileAttachment']) {
      const select = safeSelectForModel(model);
      const keys = Object.keys(select).map((k) => k.toLowerCase());
      for (const key of keys) {
        expect(key).not.toMatch(/hash|token|secret|encrypted|password|credential|apikey|storagekey/);
      }
      // id is always present (it is the keyset cursor).
      expect(select.id).toBe(true);
    }
  });
});
