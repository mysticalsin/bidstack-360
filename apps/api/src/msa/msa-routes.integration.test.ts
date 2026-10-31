/**
 * MSA library routes: RBAC, org and scope isolation, file checks, versions,
 * short-lived downloads, audit, timeline and the per-account summary.
 * Storage is an in-memory fake (S3 presign and local token modes).
 */
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import { __setStorageForTest } from '../storage/index.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import {
  DOCX_TYPE,
  PDF_TYPE,
  fakeDocx,
  fakePdf,
  makeFakeStorage,
  type FakeStorage,
} from '../test-support/msa-storage.js';
import { issueMsaDownloadToken } from './download-token.js';

const TAG = `msa${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let adminId = '';
let otherUserId = '';
let companyFr = '';
let companyDe = '';
let storage: FakeStorage;
let prevRoleHeader: string | undefined;
let prevTokenKeyUnset = false;

type Inj = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown; role?: string };
function call({ method, url, payload, role }: Inj) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: role ? { 'x-bidstack-e2e-role': role } : {},
  });
}

async function createMsa(body: Record<string, unknown>, role?: string): Promise<string> {
  const res = await call({ method: 'POST', url: '/msa', payload: body, role });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

async function uploadVersion(contractId: string, body: Buffer, contentType: string, fileName: string) {
  const urlRes = await call({
    method: 'POST',
    url: `/msa/${contractId}/versions/upload-url`,
    payload: { fileName, contentType, bytes: body.length },
  });
  expect(urlRes.statusCode, urlRes.body).toBe(200);
  const { storageKey } = urlRes.json() as { storageKey: string };
  storage.put(storageKey, body, contentType);
  const res = await call({
    method: 'POST',
    url: `/msa/${contractId}/versions`,
    payload: { storageKey, fileName, contentType, bytes: body.length, note: 'signed copy' },
  });
  return { res, storageKey };
}

async function auditActions(targetId: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { orgId: orgA.orgId, targetId },
    orderBy: { at: 'asc' },
    select: { action: true },
    take: 500,
  });
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  // Runtime-generated key for the sealed local download token.
  if (!process.env.INTEGRATION_TOKEN_KEY) {
    prevTokenKeyUnset = true;
    process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString('hex');
  }
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('msa-a');
  orgB = await createIsolatedOrg('msa-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  adminId = (await prisma.user.findFirstOrThrow({ where: { orgId: orgA.orgId }, orderBy: { createdAt: 'asc' } })).id;
  otherUserId = (
    await prisma.user.create({
      data: { orgId: orgA.orgId, clerkUser: `user_${TAG}_other`, email: `${TAG}.other@example.test`, name: 'Other Owner' },
    })
  ).id;
  companyFr = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Paris`, countryCode: 'FR' } })).id;
  companyDe = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Berlin`, countryCode: 'DE' } })).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setStorageForTest(null);
  await server?.close();
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  if (prevTokenKeyUnset) delete process.env.INTEGRATION_TOKEN_KEY;
  invalidateAccessScope(orgA.orgId);
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
  if (orgB.orgId) await dropIsolatedOrg(orgB.orgId);
});

beforeEach(() => {
  storage = makeFakeStorage('s3');
  __setStorageForTest(storage);
});

const futureDate = (days: number) => new Date(Date.UTC(2026, 9, 31) + days * 86_400_000).toISOString();
const inDays = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * 86_400_000).toISOString();
};

describe('create, list, detail', () => {
  let msaId = '';
  let sowId = '';

  it('creates an MSA and a SOW under it, with validation', async () => {
    msaId = await createMsa({
      companyId: companyFr,
      title: `${TAG} Master Services Agreement`,
      counterparty: 'Paris SA',
      status: 'active',
      effectiveDate: futureDate(-365),
      expiryDate: inDays(45),
      autoRenew: true,
      noticePeriodDays: 30,
      governingLaw: 'French law',
      liabilityCap: { amountMicros: 2_000_000_000_000, currency: 'eur' },
      paymentTerms: 'Net 45',
      tags: ['strategic', 'strategic', 'emea'],
    });
    sowId = await createMsa({ companyId: companyFr, kind: 'sow', parentId: msaId, title: `${TAG} SOW 1` });

    const noParent = await call({ method: 'POST', url: '/msa', payload: { companyId: companyFr, kind: 'sow', title: 'x' } });
    expect(noParent.statusCode).toBe(400);
    const wrongCompany = await call({
      method: 'POST',
      url: '/msa',
      payload: { companyId: companyDe, kind: 'amendment', parentId: msaId, title: 'x' },
    });
    expect(wrongCompany.statusCode).toBe(400);
    const msaUnderMsa = await call({
      method: 'POST',
      url: '/msa',
      payload: { companyId: companyFr, kind: 'msa', parentId: msaId, title: 'x' },
    });
    expect(msaUnderMsa.statusCode).toBe(400);
    expect(await auditActions(msaId)).toContain('msa.create');
  });

  it('lists top-level agreements with filters', async () => {
    await createMsa({ companyId: companyDe, title: `${TAG} Berlin draft`, status: 'draft' });
    const all = await call({ method: 'GET', url: `/msa?q=${TAG}` });
    expect(all.statusCode, all.body).toBe(200);
    const body = all.json() as { items: Array<{ id: string; title: string; childCount: number; noticeDeadline: string | null }>; total: number };
    expect(body.items.map((i) => i.title).sort()).toEqual([`${TAG} Berlin draft`, `${TAG} Master Services Agreement`]);
    const msa = body.items.find((i) => i.id === msaId)!;
    expect(msa.childCount).toBe(1);
    expect(msa.noticeDeadline).toBe(inDays(15));

    const drafts = (await call({ method: 'GET', url: `/msa?q=${TAG}&status=draft` })).json() as { items: unknown[] };
    expect(drafts.items).toHaveLength(1);
    const expiring = (await call({ method: 'GET', url: `/msa?q=${TAG}&expiringWithinDays=60` })).json() as { items: Array<{ id: string }> };
    expect(expiring.items.map((i) => i.id)).toEqual([msaId]);
    const tagged = (await call({ method: 'GET', url: `/msa?tag=emea` })).json() as { items: Array<{ id: string }> };
    expect(tagged.items.map((i) => i.id)).toEqual([msaId]);
    const children = (await call({ method: 'GET', url: `/msa?parentId=${msaId}` })).json() as { items: Array<{ id: string }> };
    expect(children.items.map((i) => i.id)).toEqual([sowId]);
    const sows = (await call({ method: 'GET', url: `/msa?kind=sow&topLevel=false&q=${TAG}` })).json() as { items: Array<{ id: string }> };
    expect(sows.items.map((i) => i.id)).toEqual([sowId]);
  });

  it('detail carries terms, children and parent; view is audited', async () => {
    const res = await call({ method: 'GET', url: `/msa/${msaId}` });
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json() as Record<string, unknown> & { children: Array<{ id: string }>; tags: string[] };
    expect(d.liabilityCap).toEqual({ amountMicros: 2_000_000_000_000, currency: 'EUR' });
    expect(d.governingLaw).toBe('French law');
    expect(d.tags).toEqual(['strategic', 'emea']);
    expect(d.children.map((c) => c.id)).toEqual([sowId]);
    const sow = (await call({ method: 'GET', url: `/msa/${sowId}` })).json() as { parent: { id: string } | null };
    expect(sow.parent?.id).toBe(msaId);
    expect(await auditActions(msaId)).toContain('msa.view');
  });

  it('summary for the account page', async () => {
    const res = await call({ method: 'GET', url: `/msa/accounts/${companyFr}/summary` });
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json() as {
      total: number;
      childCounts: { sow: number };
      primary: { id: string };
      nextNoticeDeadline: { id: string; days: number };
      nextExpiry: { days: number };
      expiringWithin90Days: number;
    };
    expect(s.total).toBe(2);
    expect(s.childCounts.sow).toBe(1);
    expect(s.primary.id).toBe(msaId);
    expect(s.nextNoticeDeadline).toMatchObject({ id: msaId, days: 15 });
    expect(s.nextExpiry.days).toBe(45);
    expect(s.expiringWithin90Days).toBe(1);
  });

  it('patch records a field-level diff and redacts notes', async () => {
    const res = await call({
      method: 'PATCH',
      url: `/msa/${msaId}`,
      payload: { status: 'in_negotiation', paymentTerms: 'Net 30', notes: 'secret pricing' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { changed: string[] }).changed.sort()).toEqual(['notes', 'paymentTerms', 'status']);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { orgId: orgA.orgId, targetId: msaId, action: 'msa.update' },
      orderBy: { at: 'desc' },
    });
    const changed = (log.diff as { changed: Record<string, { from: unknown; to: unknown }> }).changed;
    expect(changed.paymentTerms).toEqual({ from: 'Net 45', to: 'Net 30' });
    expect(changed.status).toEqual({ from: 'active', to: 'in_negotiation' });
    expect(JSON.stringify(log.diff)).not.toContain('secret pricing');
  });

  it('timeline merges audit events with milestones', async () => {
    const res = await call({ method: 'GET', url: `/msa/${msaId}/timeline` });
    expect(res.statusCode, res.body).toBe(200);
    const actions = (res.json() as { items: Array<{ action: string }> }).items.map((i) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['msa.create', 'msa.update', 'msa.effective', 'msa.notice_deadline', 'msa.renewal']));
    expect(actions).not.toContain('msa.view');
    const withViews = (await call({ method: 'GET', url: `/msa/${msaId}/timeline?includeViews=true` })).json() as { items: Array<{ action: string }> };
    expect(withViews.items.map((i) => i.action)).toContain('msa.view');
  });

  it('archive needs msa:admin and no live children', async () => {
    expect((await call({ method: 'DELETE', url: `/msa/${sowId}`, role: 'account-executive' })).statusCode).toBe(403);
    expect((await call({ method: 'DELETE', url: `/msa/${msaId}` })).statusCode).toBe(409);
    expect((await call({ method: 'DELETE', url: `/msa/${sowId}` })).statusCode).toBe(204);
    expect((await call({ method: 'GET', url: `/msa/${sowId}` })).statusCode).toBe(404);
    expect(await auditActions(sowId)).toContain('msa.archive');
  });
});

describe('RBAC', () => {
  it('read-only and SDR can read but not write', async () => {
    const id = await createMsa({ companyId: companyFr, title: `${TAG} rbac` });
    for (const role of ['read-only', 'sdr']) {
      expect((await call({ method: 'GET', url: `/msa/${id}`, role })).statusCode).toBe(200);
      expect((await call({ method: 'PATCH', url: `/msa/${id}`, payload: { title: 'x' }, role })).statusCode).toBe(403);
      expect((await call({ method: 'POST', url: '/msa', payload: { companyId: companyFr, title: 'x' }, role })).statusCode).toBe(403);
    }
  });

  it('a role without msa:read is refused every read', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { orgId: orgA.orgId, name: 'SDR' } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: 'msa:read' } });
    await prisma.rolePermission.updateMany({ where: { roleId: role.id, permissionId: perm.id }, data: { deletedAt: new Date() } });
    clearRbacDecisionCacheForTest();
    try {
      expect((await call({ method: 'GET', url: '/msa', role: 'sdr' })).statusCode).toBe(403);
      expect((await call({ method: 'GET', url: `/msa/accounts/${companyFr}/summary`, role: 'sdr' })).statusCode).toBe(403);
    } finally {
      await prisma.$executeRaw`UPDATE role_permissions SET deleted_at = NULL WHERE role_id = ${role.id}::uuid AND permission_id = ${perm.id}::uuid`;
      clearRbacDecisionCacheForTest();
    }
  });

  it('only the owner, the creator or an msa:admin can edit', async () => {
    const row = await prisma.contractAgreement.create({
      data: {
        orgId: orgA.orgId,
        accountKey: 'x',
        companyId: companyFr,
        kind: 'msa',
        reference: `${TAG} owned`,
        title: `${TAG} owned`,
        ownerId: otherUserId,
        createdById: otherUserId,
      },
    });
    const ae = await call({ method: 'PATCH', url: `/msa/${row.id}`, payload: { title: 'hijack' }, role: 'account-executive' });
    expect(ae.statusCode).toBe(403);
    const upload = await call({
      method: 'POST',
      url: `/msa/${row.id}/versions/upload-url`,
      payload: { fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 10 },
      role: 'account-executive',
    });
    expect(upload.statusCode).toBe(403);
    expect((await call({ method: 'PATCH', url: `/msa/${row.id}`, payload: { title: 'admin edit' } })).statusCode).toBe(200);
  });

  it('owner must be a user of the same org', async () => {
    const foreign = await prisma.user.findFirstOrThrow({ where: { orgId: orgB.orgId } });
    const res = await call({ method: 'POST', url: '/msa', payload: { companyId: companyFr, title: 'x', ownerId: foreign.id } });
    expect(res.statusCode).toBe(400);
  });
});

describe('files and versions', () => {
  let id = '';
  beforeAll(async () => {
    id = await createMsa({ companyId: companyFr, title: `${TAG} files` });
  });

  it('accepts a PDF, then a DOCX as version 2, with server-side SHA-256', async () => {
    const pdf = fakePdf('first');
    const v1 = await uploadVersion(id, pdf, PDF_TYPE, 'msa-signed.pdf');
    expect(v1.res.statusCode, v1.res.body).toBe(201);
    const { createHash } = await import('node:crypto');
    expect(v1.res.json()).toMatchObject({ versionNo: 1, sha256: createHash('sha256').update(pdf).digest('hex') });
    expect(v1.storageKey).toContain(`/msa-${id}/`);
    const v2 = await uploadVersion(id, fakeDocx('redline'), DOCX_TYPE, 'msa-redline.docx');
    expect(v2.res.statusCode, v2.res.body).toBe(201);
    expect((v2.res.json() as { versionNo: number }).versionNo).toBe(2);
    const detail = (await call({ method: 'GET', url: `/msa/${id}` })).json() as {
      versions: Array<{ versionNo: number; extractionStatus: string }>;
      latestVersion: { versionNo: number };
    };
    expect(detail.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(detail.latestVersion.versionNo).toBe(2);
    expect(await auditActions(id)).toContain('msa.version.upload');
  });

  it('rejects an identical re-upload', async () => {
    const again = await uploadVersion(id, fakePdf('first'), PDF_TYPE, 'copy.pdf');
    expect(again.res.statusCode).toBe(409);
  });

  it('rejects disallowed types and oversize files before signing', async () => {
    const exe = await call({
      method: 'POST',
      url: `/msa/${id}/versions/upload-url`,
      payload: { fileName: 'a.exe', contentType: 'application/x-msdownload', bytes: 10 },
    });
    expect(exe.statusCode).toBe(400);
    const big = await call({
      method: 'POST',
      url: `/msa/${id}/versions/upload-url`,
      payload: { fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 26 * 1024 * 1024 },
    });
    expect(big.statusCode).toBe(400);
  });

  it('rejects content that is not really a PDF or DOCX, and deletes it', async () => {
    const fake = await uploadVersion(id, Buffer.from('MZ\x90\x00 not a pdf at all'), PDF_TYPE, 'evil.pdf');
    expect(fake.res.statusCode).toBe(400);
    expect(storage.deleted).toContain(fake.storageKey);
    const zip = await uploadVersion(id, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml')]), DOCX_TYPE, 'sheet.docx');
    expect(zip.res.statusCode).toBe(400);
    const mismatch = await uploadVersion(id, fakeDocx('x'), PDF_TYPE, 'liar.pdf');
    expect(mismatch.res.statusCode).toBe(400);
    expect(await auditActions(id)).toContain('msa.version.rejected');
  });

  it('rejects a size mismatch and keys issued elsewhere', async () => {
    const urlRes = await call({
      method: 'POST',
      url: `/msa/${id}/versions/upload-url`,
      payload: { fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 50 },
    });
    const { storageKey } = urlRes.json() as { storageKey: string };
    storage.put(storageKey, fakePdf('short'), PDF_TYPE);
    const res = await call({
      method: 'POST',
      url: `/msa/${id}/versions`,
      payload: { storageKey, fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 50 },
    });
    expect(res.statusCode).toBe(400);

    const other = await createMsa({ companyId: companyFr, title: `${TAG} other` });
    const otherKey = ((await call({
      method: 'POST',
      url: `/msa/${other}/versions/upload-url`,
      payload: { fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 10 },
    })).json() as { storageKey: string }).storageKey;
    const cross = await call({
      method: 'POST',
      url: `/msa/${id}/versions`,
      payload: { storageKey: otherKey, fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 10 },
    });
    expect(cross.statusCode).toBe(403);
    const foreignOrgKey = `orgs/${orgB.orgId}/accounts/msa-${id}/x-a.pdf`;
    const foreign = await call({
      method: 'POST',
      url: `/msa/${id}/versions`,
      payload: { storageKey: foreignOrgKey, fileName: 'a.pdf', contentType: PDF_TYPE, bytes: 10 },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('S3: download URL is a short-lived presign and is audited', async () => {
    const detail = (await call({ method: 'GET', url: `/msa/${id}` })).json() as { versions: Array<{ id: string }> };
    const res = await call({ method: 'GET', url: `/msa/${id}/versions/${detail.versions[0]!.id}/download-url` });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { url: string; expiresAt: string };
    expect(body.url).toContain('X-Amz-Expires=120');
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
    expect(storage.lastDownloadOpts?.expiresInSeconds).toBe(120);
    expect(await auditActions(id)).toContain('msa.download');
  });

  it('local: sealed token download streams once valid and refuses tampering or expiry', async () => {
    const local = makeFakeStorage('local');
    for (const [k, v] of storage.objects) local.objects.set(k, v);
    // Re-seed from the DB rows so the local fake can serve them.
    const versions = await prisma.contractFileVersion.findMany({
      where: { orgId: orgA.orgId, contractId: id },
      select: { id: true, fileAttachment: { select: { storageKey: true } } },
      orderBy: { versionNo: 'asc' },
      take: 10,
    });
    local.put(versions[0]!.fileAttachment.storageKey, fakePdf('first'), PDF_TYPE);
    __setStorageForTest(local);
    const res = await call({ method: 'GET', url: `/msa/${id}/versions/${versions[0]!.id}/download-url` });
    expect(res.statusCode, res.body).toBe(200);
    const url = new URL((res.json() as { url: string }).url);
    expect(url.pathname).toBe('/api/v1/msa/download');
    const dl = await server.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(String(dl.headers['content-disposition'])).toContain('attachment');
    expect(dl.body).toContain('%PDF-');
    // CORS for the web PDF preview: allowed origin echoed, others get nothing.
    const webOrigin = 'http://localhost:5173';
    const fromWeb = await server.inject({ method: 'GET', url: `${url.pathname}${url.search}`, headers: { origin: webOrigin } });
    expect(fromWeb.statusCode).toBe(200);
    expect(fromWeb.headers['access-control-allow-origin']).toBe(webOrigin);
    expect(String(fromWeb.headers['access-control-expose-headers'])).toContain('Content-Disposition');
    expect(fromWeb.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const fromEvil = await server.inject({ method: 'GET', url: `${url.pathname}${url.search}`, headers: { origin: 'https://evil.example' } });
    expect(fromEvil.headers['access-control-allow-origin']).toBeUndefined();
    expect(fromEvil.headers['access-control-expose-headers']).toBeUndefined();
    const preflight = await server.inject({
      method: 'OPTIONS',
      url: `${url.pathname}${url.search}`,
      headers: { origin: webOrigin, 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBeLessThan(300);
    expect(preflight.headers['access-control-allow-origin']).toBe(webOrigin);

    const t = url.searchParams.get('t')!;
    const tampered = await server.inject({ method: 'GET', url: `/api/v1/msa/download?t=${encodeURIComponent(t.slice(0, -4) + 'AAAA')}` });
    expect(tampered.statusCode).toBe(404);
    const expired = issueMsaDownloadToken({ orgId: orgA.orgId, userId: adminId, versionId: versions[0]!.id }, Date.now() - 10 * 60_000);
    const old = await server.inject({ method: 'GET', url: `/api/v1/msa/download?t=${encodeURIComponent(expired.token)}` });
    expect(old.statusCode).toBe(404);
  });

  it('version archive needs msa:admin', async () => {
    const detail = (await call({ method: 'GET', url: `/msa/${id}` })).json() as { versions: Array<{ id: string }> };
    const vid = detail.versions[0]!.id;
    expect((await call({ method: 'DELETE', url: `/msa/${id}/versions/${vid}`, role: 'account-executive' })).statusCode).toBe(403);
    expect((await call({ method: 'DELETE', url: `/msa/${id}/versions/${vid}` })).statusCode).toBe(204);
    expect((await call({ method: 'GET', url: `/msa/${id}/versions/${vid}/download-url` })).statusCode).toBe(404);
  });

  it('MSA files never surface through the generic /files routes', async () => {
    const v = await prisma.contractFileVersion.findFirstOrThrow({
      where: { orgId: orgA.orgId, contractId: id },
      select: { fileAttachmentId: true },
    });
    const list = await call({ method: 'GET', url: `/files?accountId=msa-${id}` });
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(0);
    expect((await call({ method: 'GET', url: `/files/${v.fileAttachmentId}/download` })).statusCode).toBe(404);
    expect((await call({ method: 'DELETE', url: `/files/${v.fileAttachmentId}` })).statusCode).toBe(404);
  });
});

describe('legacy contract-agreements card', () => {
  it('maps new statuses and kinds onto legacy values', async () => {
    const parent = await createMsa({ companyId: companyFr, title: `${TAG} legacy`, status: 'in_negotiation' });
    await createMsa({ companyId: companyFr, kind: 'amendment', parentId: parent, title: `${TAG} amend` });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyFr } });
    const res = await call({ method: 'GET', url: `/contract-agreements?accountKey=${encodeURIComponent(company.name)}` });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: Array<{ id: string; status: string; kind: string }> }).items;
    expect(items.find((i) => i.id === parent)?.status).toBe('pending');
    expect(items.some((i) => i.kind === 'other')).toBe(true);
  });
});

describe('cross-tenant isolation', () => {
  it('another org cannot see, list, download or attach to org A MSAs', async () => {
    const id = await createMsa({ companyId: companyFr, title: `${TAG} tenant` });
    const v = await uploadVersion(id, fakePdf('tenant'), PDF_TYPE, 'tenant.pdf');
    const versionId = (v.res.json() as { id: string }).id;
    const restoreB = useIsolatedOrgAuth(orgB.clerkOrg);
    try {
      expect((await call({ method: 'GET', url: `/msa/${id}` })).statusCode).toBe(404);
      expect((await call({ method: 'GET', url: `/msa/${id}/timeline` })).statusCode).toBe(404);
      expect((await call({ method: 'GET', url: `/msa/${id}/versions/${versionId}/download-url` })).statusCode).toBe(404);
      expect((await call({ method: 'PATCH', url: `/msa/${id}`, payload: { title: 'x' } })).statusCode).toBe(404);
      expect((await call({ method: 'DELETE', url: `/msa/${id}` })).statusCode).toBe(404);
      expect((await call({ method: 'GET', url: `/msa/accounts/${companyFr}/summary` })).statusCode).toBe(404);
      const list = (await call({ method: 'GET', url: `/msa?q=${TAG}` })).json() as { items: unknown[] };
      expect(list.items).toHaveLength(0);
      const create = await call({ method: 'POST', url: '/msa', payload: { companyId: companyFr, title: 'x' } });
      expect(create.statusCode).toBe(404);
    } finally {
      restoreB();
      useIsolatedOrgAuth(orgA.clerkOrg);
    }
    // A token minted for org A cannot be replayed as another org's version.
    const bUser = await prisma.user.findFirstOrThrow({ where: { orgId: orgB.orgId } });
    __setStorageForTest(makeFakeStorage('local'));
    const forged = issueMsaDownloadToken({ orgId: orgB.orgId, userId: bUser.id, versionId });
    expect((await server.inject({ method: 'GET', url: `/api/v1/msa/download?t=${encodeURIComponent(forged.token)}` })).statusCode).toBe(404);
  });
});

describe('access scope', () => {
  it('a FR-only user sees FR MSAs only', async () => {
    const fr = await createMsa({ companyId: companyFr, title: `${TAG} scope fr` });
    const de = await createMsa({ companyId: companyDe, title: `${TAG} scope de` });
    const group = await prisma.userGroup.create({
      data: { orgId: orgA.orgId, name: `${TAG}-grp`, scopeCountries: ['FR'], scopeAll: false },
    });
    await prisma.userGroupMember.create({ data: { orgId: orgA.orgId, userId: adminId, groupId: group.id } });
    invalidateAccessScope(orgA.orgId, adminId);
    try {
      const list = (await call({ method: 'GET', url: `/msa?q=${TAG} scope` })).json() as { items: Array<{ id: string }> };
      expect(list.items.map((i) => i.id)).toEqual([fr]);
      expect((await call({ method: 'GET', url: `/msa/${de}` })).statusCode).toBe(404);
      expect((await call({ method: 'GET', url: `/msa/${de}/timeline` })).statusCode).toBe(404);
      expect((await call({ method: 'GET', url: `/msa/accounts/${companyDe}/summary` })).statusCode).toBe(404);
      expect((await call({ method: 'POST', url: '/msa', payload: { companyId: companyDe, title: 'x' } })).statusCode).toBe(404);
      expect((await call({ method: 'GET', url: `/msa/${fr}` })).statusCode).toBe(200);
    } finally {
      await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
      await prisma.userGroup.delete({ where: { id: group.id } });
      invalidateAccessScope(orgA.orgId, adminId);
    }
  });
});
