/**
 * MSA full-text search and the extraction hand-off: finalize enqueues a job,
 * search ranks extracted text with [[ ]] snippets, respects org and company
 * scope, and is audited.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import type { MsaTextExtractJob } from '@bidstack/shared';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { __setMsaTextExtractEnqueueForTest } from '../queues/msa-text-extract.js';
import { buildServer } from '../server.js';
import { __setStorageForTest } from '../storage/index.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { PDF_TYPE, fakePdf, makeFakeStorage } from '../test-support/msa-storage.js';

const TAG = `msas${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let adminId = '';
let companyFr = '';
let companyDe = '';
const enqueued: MsaTextExtractJob[] = [];
const storage = makeFakeStorage('s3');
let prevRoleHeader: string | undefined;

async function createWithText(companyId: string, title: string, text: string) {
  const res = await server.inject({ method: 'POST', url: '/api/v1/msa', payload: { companyId, title } });
  expect(res.statusCode, res.body).toBe(201);
  const id = (res.json() as { id: string }).id;
  const body = fakePdf(text);
  const urlRes = await server.inject({
    method: 'POST',
    url: `/api/v1/msa/${id}/versions/upload-url`,
    payload: { fileName: 'msa.pdf', contentType: PDF_TYPE, bytes: body.length },
  });
  const { storageKey } = urlRes.json() as { storageKey: string };
  storage.put(storageKey, body, PDF_TYPE);
  const fin = await server.inject({
    method: 'POST',
    url: `/api/v1/msa/${id}/versions`,
    payload: { storageKey, fileName: 'msa.pdf', contentType: PDF_TYPE, bytes: body.length },
  });
  expect(fin.statusCode, fin.body).toBe(201);
  const versionId = (fin.json() as { id: string }).id;
  // Stand-in for the worker: it writes extracted text and flips the status.
  await prisma.contractFileVersion.update({
    where: { id: versionId },
    data: { extractedText: text, extractionStatus: 'done', extractedAt: new Date() },
  });
  return { id, versionId };
}

beforeAll(async () => {
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('msa-search-a');
  orgB = await createIsolatedOrg('msa-search-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  adminId = (await prisma.user.findFirstOrThrow({ where: { orgId: orgA.orgId }, orderBy: { createdAt: 'asc' } })).id;
  companyFr = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Paris`, countryCode: 'FR' } })).id;
  companyDe = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Berlin`, countryCode: 'DE' } })).id;
  __setStorageForTest(storage);
  __setMsaTextExtractEnqueueForTest(async (job) => {
    enqueued.push(job);
    return `job-${job.versionId}`;
  });
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setMsaTextExtractEnqueueForTest(null);
  __setStorageForTest(null);
  await server?.close();
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  invalidateAccessScope(orgA.orgId);
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
  if (orgB.orgId) await dropIsolatedOrg(orgB.orgId);
});

describe('MSA full-text search', () => {
  let fr: { id: string; versionId: string };
  let de: { id: string; versionId: string };

  beforeAll(async () => {
    fr = await createWithText(companyFr, `${TAG} Paris MSA`, 'The supplier liability cap is twelve months of fees. Governing law: France.');
    de = await createWithText(companyDe, `${TAG} Berlin MSA`, 'Liability is unlimited for data breaches. Governing law: Germany. Payment net sixty.');
  });

  it('finalize enqueues one extraction job per version, org-bound', () => {
    expect(enqueued.map((j) => j.versionId)).toEqual(expect.arrayContaining([fr.versionId, de.versionId]));
    expect(enqueued.every((j) => j.orgId === orgA.orgId)).toBe(true);
  });

  it('ranks matches and returns [[ ]] snippets', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/msa/search?q=liability%20cap' });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: Array<{ contractId: string; snippet: string; versionNo: number }> }).items;
    expect(items.map((i) => i.contractId)).toEqual([fr.id]);
    expect(items[0]!.snippet).toContain('[[liability]]');
    expect(items[0]!.versionNo).toBe(1);

    const law = (await server.inject({ method: 'GET', url: '/api/v1/msa/search?q=governing%20law' })).json() as { items: Array<{ contractId: string }> };
    expect(law.items.map((i) => i.contractId).sort()).toEqual([fr.id, de.id].sort());
    const byCompany = (await server.inject({ method: 'GET', url: `/api/v1/msa/search?q=governing%20law&companyId=${companyDe}` })).json() as { items: Array<{ contractId: string }> };
    expect(byCompany.items.map((i) => i.contractId)).toEqual([de.id]);
  });

  it('ignores archived versions and rejects one-letter queries', async () => {
    const v = await createWithText(companyFr, `${TAG} archived`, 'zebracorn clause');
    expect(((await server.inject({ method: 'GET', url: '/api/v1/msa/search?q=zebracorn' })).json() as { items: unknown[] }).items).toHaveLength(1);
    await server.inject({ method: 'DELETE', url: `/api/v1/msa/${v.id}/versions/${v.versionId}` });
    expect(((await server.inject({ method: 'GET', url: '/api/v1/msa/search?q=zebracorn' })).json() as { items: unknown[] }).items).toHaveLength(0);
    expect((await server.inject({ method: 'GET', url: '/api/v1/msa/search?q=z' })).statusCode).toBe(400);
  });

  it('is audited with the query', async () => {
    const log = await prisma.auditLog.findFirst({
      where: { orgId: orgA.orgId, action: 'msa.search' },
      orderBy: { at: 'desc' },
    });
    expect(log).not.toBeNull();
    expect((log!.diff as { q: string; hits: number }).q).toBe('zebracorn');
  });

  it('respects company scope', async () => {
    const group = await prisma.userGroup.create({
      data: { orgId: orgA.orgId, name: `${TAG}-grp`, scopeCountries: ['FR'], scopeAll: false },
    });
    await prisma.userGroupMember.create({ data: { orgId: orgA.orgId, userId: adminId, groupId: group.id } });
    invalidateAccessScope(orgA.orgId, adminId);
    try {
      const res = (await server.inject({ method: 'GET', url: '/api/v1/msa/search?q=governing%20law' })).json() as { items: Array<{ contractId: string }> };
      expect(res.items.map((i) => i.contractId)).toEqual([fr.id]);
    } finally {
      await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
      await prisma.userGroup.delete({ where: { id: group.id } });
      invalidateAccessScope(orgA.orgId, adminId);
    }
  });

  it('never returns another org', async () => {
    const restoreB = useIsolatedOrgAuth(orgB.clerkOrg);
    try {
      const res = (await server.inject({ method: 'GET', url: '/api/v1/msa/search?q=governing%20law' })).json() as { items: unknown[] };
      expect(res.items).toHaveLength(0);
      const re = await server.inject({ method: 'POST', url: `/api/v1/msa/${fr.id}/versions/${fr.versionId}/reextract` });
      expect(re.statusCode).toBe(404);
    } finally {
      restoreB();
      useIsolatedOrgAuth(orgA.clerkOrg);
    }
  });

  it('reextract resets the status and enqueues again', async () => {
    const before = enqueued.length;
    const res = await server.inject({ method: 'POST', url: `/api/v1/msa/${fr.id}/versions/${fr.versionId}/reextract` });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({ queued: true });
    expect(enqueued.length).toBe(before + 1);
    const v = await prisma.contractFileVersion.findUniqueOrThrow({ where: { id: fr.versionId } });
    expect(v.extractionStatus).toBe('pending');
    const ro = await server.inject({
      method: 'POST',
      url: `/api/v1/msa/${fr.id}/versions/${fr.versionId}/reextract`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(ro.statusCode).toBe(403);
  });
});
