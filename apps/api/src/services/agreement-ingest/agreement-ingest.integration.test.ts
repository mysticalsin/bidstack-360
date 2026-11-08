/**
 * Agreement pull by API (slice 13a): REST ingest, SharePoint and DocuSign
 * syncs, all landing as MSA intake drafts for human review.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';
import { encryptToken } from '@bidstack/shared/token-crypto';

import { invalidateAccessScope } from '../../lib/access-scope.js';
import { __setAgreementIngestEnqueueForTest, sweepQueuedAgreementItems } from '../../queues/agreement-ingest.js';
import { buildServer } from '../../server.js';
import { __setAgreementConnectionFetchForTest } from '../agreement-sources/connections.js';
import { __setStorageForTest } from '../../storage/index.js';
import {
  DOCUSIGN_ENVELOPES,
  DRIVE_ID,
  fakeFetch,
  GRAPH_DELTA_PAGE_1,
  GRAPH_DELTA_PAGE_2,
  json,
} from '../../test-support/agreement-source-fixtures.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../../test-support/isolated-org.js';
import { fakeDocx, makeFakeStorage, type FakeStorage } from '../../test-support/msa-storage.js';
import { syntheticNorthwindMsaPdf } from '../../test-support/synthetic-msa-pdf.js';
import { runAgreementSourceSync } from '../agreement-sources/sync.js';
import { processAgreementIngestItem, readCapped } from './process.js';

let server: FastifyInstance;
let org = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let storage: FakeStorage;
let pdf: Buffer;
const enqueued: Array<{ kind: string; jobId: string }> = [];
const rawKeys: string[] = [];

type Inj = { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: unknown; role?: string; headers?: Record<string, string> };
function call({ method, url, payload, role, headers }: Inj) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: { ...(role ? { 'x-bidstack-e2e-role': role } : {}), ...(headers ?? {}) },
  });
}

/** Same text layer, distinct bytes, so sha256 dedupe does not join tests. */
function uniquePdf(): Buffer {
  return Buffer.concat([pdf, Buffer.from(`\n% ${randomUUID()}\n`)]);
}

function ingestBody(overrides: Record<string, unknown> = {}) {
  return {
    externalSource: 'clm.test',
    externalId: `doc-${randomUUID()}`,
    fileName: 'northwind-msa.pdf',
    file: { base64: uniquePdf().toString('base64') },
    ...overrides,
  };
}

async function makeKey(opts: { companyIds?: string[]; readOnly?: boolean; scopes?: string[] } = {}) {
  const raw = `bs_test_ingest_${randomUUID()}`;
  rawKeys.push(raw);
  const key = await prisma.apiKey.create({
    data: {
      orgId: org.orgId,
      name: 'Agreement ingest test key',
      prefix: raw.slice(0, 8),
      hashedKey: createHash('sha256').update(raw).digest('hex'),
      scopes: opts.scopes ?? ['read', 'write'],
      readOnly: opts.readOnly ?? false,
      unrestrictedScope: !opts.companyIds,
      companyIds: opts.companyIds ?? [],
    },
  });
  return { raw, id: key.id };
}

const TENANT = '0f0f0f0f-1111-4222-8333-444444444444';
const GRAPH_ENV = {
  MICROSOFT_GRAPH_CLIENT_ID: 'client-fixture',
  MICROSOFT_GRAPH_CLIENT_SECRET: 'not-a-secret',
};
const DRIVE_ROOT: [RegExp, () => Response] = [/\/root\?\$select=id,sharepointIds/, () => json({ id: 'root', sharepointIds: { tenantId: TENANT } })];
const savedEnv = { ...process.env };

beforeAll(async () => {
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  Object.assign(process.env, {
    INTEGRATION_TOKEN_KEY: randomBytes(32).toString('hex'),
    ...GRAPH_ENV,
    DOCUSIGN_INTEGRATION_KEY: 'ik',
    DOCUSIGN_CLIENT_SECRET: 'not-a-secret',
  });
  _resetIntegrationTokenKey();
  org = await createIsolatedOrg('agreement-ingest');
  const admin = (await prisma.user.findFirstOrThrow({ where: { orgId: org.orgId }, orderBy: { createdAt: 'asc' } })).id;
  await prisma.org.update({ where: { id: org.orgId }, data: { microsoftTenantId: TENANT } });
  await prisma.agreementConnection.create({ data: { orgId: org.orgId, provider: 'sharepoint', status: 'connected', externalTenantId: TENANT, createdById: admin } });
  await prisma.agreementConnection.create({
    data: { orgId: org.orgId, provider: 'docusign', status: 'connected', accountId: 'acct', baseUri: 'https://demo.docusign.net', secretEncrypted: encryptToken('refresh-0'), createdById: admin },
  });
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  pdf = await syntheticNorthwindMsaPdf();
  __setAgreementIngestEnqueueForTest(async (job, jobId) => {
    enqueued.push({ kind: job.kind, jobId });
    return jobId;
  });
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setAgreementConnectionFetchForTest(null);
  process.env = savedEnv;
  _resetIntegrationTokenKey();
  __setAgreementIngestEnqueueForTest(null);
  __setStorageForTest(null);
  await server?.close();
  restoreAuth?.();
  invalidateAccessScope(org.orgId);
  if (org.orgId) await dropIsolatedOrg(org.orgId);
});

beforeEach(() => {
  __setAgreementConnectionFetchForTest(null);
  storage = makeFakeStorage('s3');
  __setStorageForTest(storage);
  enqueued.length = 0;
});

describe('POST /ingest/agreements', () => {
  it('stages, then drafts for review without creating an agreement', async () => {
    const before = await prisma.contractAgreement.count({ where: { orgId: org.orgId } });
    const res = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody({ metadata: { counterparty: 'Northwind Pharma' } }) });
    expect(res.statusCode, res.body).toBe(202);
    const item = res.json() as { id: string; status: string };
    expect(item.status).toBe('queued');
    expect(enqueued).toEqual([{ kind: 'process', jobId: `process--${org.orgId}--${item.id}` }]);

    const outcome = await processAgreementIngestItem(org.orgId, item.id);
    expect(outcome.status).toBe('drafted');
    const row = await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: item.id } });
    expect(row.pendingContent).toBeNull();
    expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
    const draft = await prisma.msaIntakeDraft.findFirstOrThrow({ where: { id: row.intakeDraftId!, orgId: org.orgId } });
    expect(draft.status).toBe('pending_review');
    expect(draft.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Northwind Pharma/)]));
    expect(await prisma.contractAgreement.count({ where: { orgId: org.orgId } })).toBe(before);

    const note = await prisma.notification.findFirst({ where: { orgId: org.orgId, url: `/agreements/intake/${draft.id}` } });
    expect(note).not.toBeNull();
    const actions = (await prisma.auditLog.findMany({ where: { orgId: org.orgId, targetId: item.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['agreement.ingest.received', 'agreement.ingest.drafted']));

    const status = await call({ method: 'GET', url: `/ingest/agreements/${item.id}` });
    expect(status.json()).toMatchObject({ status: 'drafted', intakeDraftId: draft.id });
  });

  it('replays the same Idempotency-Key and dedupes the same bytes for the same external id', async () => {
    const body = ingestBody();
    const key = `idem-${randomUUID()}`;
    const a = await call({ method: 'POST', url: '/ingest/agreements', payload: body, headers: { 'idempotency-key': key } });
    expect(a.statusCode, a.body).toBe(202);
    const b = await call({ method: 'POST', url: '/ingest/agreements', payload: body, headers: { 'idempotency-key': key } });
    expect(b.statusCode).toBe(202);
    expect(b.json().id).toBe(a.json().id);
    const c = await call({ method: 'POST', url: '/ingest/agreements', payload: body });
    expect(c.json().id).toBe(a.json().id);
    expect(enqueued.filter((e) => e.kind === 'process')).toHaveLength(1);
  });

  it('rejects files that are not PDF or DOCX by their bytes', async () => {
    const res = await call({
      method: 'POST',
      url: '/ingest/agreements',
      payload: ingestBody({ fileName: 'evil.pdf', file: { base64: Buffer.from('MZ not a pdf at all').toString('base64') } }),
    });
    const outcome = await processAgreementIngestItem(org.orgId, res.json().id);
    expect(outcome.status).toBe('rejected');
    expect(outcome.error).toMatch(/PDF and DOCX/);
  });

  it('refuses private URLs before fetching (SSRF)', async () => {
    const res = await call({
      method: 'POST',
      url: '/ingest/agreements',
      payload: ingestBody({ file: { url: 'http://127.0.0.1:5432/secret.pdf' } }),
    });
    expect(res.statusCode, res.body).toBe(202);
    const { fetch, calls } = fakeFetch([]);
    const outcome = await processAgreementIngestItem(org.orgId, res.json().id, { fetch });
    expect(outcome.status).toBe('rejected');
    expect(calls).toHaveLength(0);
  });

  it('validates the body and requires msa:write', async () => {
    const bad = await call({ method: 'POST', url: '/ingest/agreements', payload: { externalSource: 'X Y', externalId: '', fileName: 'a.pdf', file: {} } });
    expect(bad.statusCode).toBe(400);
    const sdr = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody(), role: 'sdr' });
    expect(sdr.statusCode).toBe(403);
  });

  it('holds API keys to their company scope and read-only flag', async () => {
    const companies = await prisma.company.findMany({ where: { orgId: org.orgId, deletedAt: null }, take: 2, select: { id: true } });
    const scoped = await makeKey({ companyIds: [companies[0]!.id] });
    const outside = await server.inject({
      method: 'POST',
      url: '/api/v1/ingest/agreements',
      headers: { 'x-api-key': scoped.raw },
      payload: ingestBody({ metadata: { companyId: companies[1]!.id } }),
    });
    expect(outside.statusCode, outside.body).toBe(403);
    const unnamed = await server.inject({ method: 'POST', url: '/api/v1/ingest/agreements', headers: { 'x-api-key': scoped.raw }, payload: ingestBody() });
    expect(unnamed.statusCode).toBe(403);
    const inside = await server.inject({
      method: 'POST',
      url: '/api/v1/ingest/agreements',
      headers: { 'x-api-key': scoped.raw },
      payload: ingestBody({ metadata: { companyId: companies[0]!.id } }),
    });
    expect(inside.statusCode, inside.body).toBe(202);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId: org.orgId, targetId: inside.json().id, action: 'agreement.ingest.received' } });
    expect(audit.diff).toMatchObject({ apiKeyId: scoped.id });

    const ro = await makeKey({ readOnly: true });
    const denied = await server.inject({ method: 'POST', url: '/api/v1/ingest/agreements', headers: { 'x-api-key': ro.raw }, payload: ingestBody() });
    expect(denied.statusCode).toBe(403);
  });

  it('turns a changed file for a confirmed agreement into a new file version, not a new agreement', async () => {
    const externalId = `doc-${randomUUID()}`;
    const first = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody({ externalId }) });
    await processAgreementIngestItem(org.orgId, first.json().id);
    const row = await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: first.json().id } });
    const draft = await prisma.msaIntakeDraft.findFirstOrThrow({ where: { id: row.intakeDraftId! } });
    const matches = draft.accountMatches as Array<{ companyId: string }>;
    const companyId = matches[0]?.companyId ?? (await prisma.company.findFirstOrThrow({ where: { orgId: org.orgId } })).id;
    const confirm = await call({ method: 'POST', url: `/msa/intake/${draft.id}/confirm`, payload: { companyId, status: 'active' } });
    expect(confirm.statusCode, confirm.body).toBe(201);
    const { contractId } = confirm.json() as { contractId: string };
    const contracts = await prisma.contractAgreement.count({ where: { orgId: org.orgId } });

    const v2 = uniquePdf();
    const second = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody({ externalId, file: { base64: v2.toString('base64') } }) });
    const outcome = await processAgreementIngestItem(org.orgId, second.json().id);
    expect(outcome).toMatchObject({ status: 'versioned', contractId });
    expect(await prisma.contractAgreement.count({ where: { orgId: org.orgId } })).toBe(contracts);
    const versions = await prisma.contractFileVersion.findMany({ where: { contractId }, orderBy: { versionNo: 'asc' } });
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.at(-1)?.note).toMatch(/rest/);
  });

  it('never versions an agreement outside the sending key scope', async () => {
    const companies = await prisma.company.findMany({ where: { orgId: org.orgId, deletedAt: null }, take: 2, orderBy: { name: 'asc' }, select: { id: true } });
    const [a, b] = [companies[0]!.id, companies[1]!.id];
    const key = await makeKey({ companyIds: [a] });
    const externalId = `doc-${randomUUID()}`;
    const post = (companyId: string) =>
      server.inject({ method: 'POST', url: '/api/v1/ingest/agreements', headers: { 'x-api-key': key.raw }, payload: ingestBody({ externalId, metadata: { companyId } }) });
    const first = await post(a);
    expect(first.statusCode, first.body).toBe(202);
    await processAgreementIngestItem(org.orgId, first.json().id);
    const draftId = (await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: first.json().id } })).intakeDraftId!;
    const confirm = await call({ method: 'POST', url: `/msa/intake/${draftId}/confirm`, payload: { companyId: a, status: 'active' } });
    expect(confirm.statusCode, confirm.body).toBe(201);
    await prisma.apiKey.update({ where: { id: key.id }, data: { companyIds: [b] } });
    invalidateAccessScope(org.orgId);
    const second = await post(b);
    expect(second.statusCode, second.body).toBe(202);
    const outcome = await processAgreementIngestItem(org.orgId, second.json().id);
    expect(outcome.status).toBe('rejected');
    expect(await prisma.contractFileVersion.count({ where: { contractId: confirm.json().contractId } })).toBe(1);

    // Another sender reusing the same external id never reaches that agreement.
    const user = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody({ externalId }) });
    expect((await processAgreementIngestItem(org.orgId, user.json().id)).status).toBe('drafted');
  });

  it('caps a URL body without trusting content-length', async () => {
    const big = new ReadableStream<Uint8Array>({
      start(c) {
        const chunk = new Uint8Array(1024 * 1024);
        for (let i = 0; i < 26; i += 1) c.enqueue(chunk);
        c.close();
      },
    });
    await expect(readCapped(new Response(big))).rejects.toThrow(/larger than 25 MB/);
    expect((await readCapped(new Response(Buffer.from('%PDF-1.7')))).toString()).toBe('%PDF-1.7');
  });

  it('the sweep recovers rows stuck in processing', async () => {
    const rest = await prisma.agreementIngestItem.create({
      data: { orgId: org.orgId, channel: 'rest', externalSource: 'x', externalId: `stuck-${randomUUID()}`, fileName: 'a.pdf', actorType: 'user', status: 'processing', pendingContent: uniquePdf() },
    });
    const src = await prisma.agreementSource.create({ data: { orgId: org.orgId, kind: 'sharepoint', name: 'Stuck', config: {}, createdById: (await prisma.user.findFirstOrThrow({ where: { orgId: org.orgId } })).id } });
    const fromSource = await prisma.agreementIngestItem.create({
      data: { orgId: org.orgId, sourceId: src.id, channel: 'sharepoint', externalSource: 'sp', externalId: `stuck-${randomUUID()}`, fileName: 'b.pdf', actorType: 'source', actorId: src.id, status: 'processing' },
    });
    await prisma.$executeRaw`UPDATE agreement_ingest_items SET updated_at = now() - interval '11 minutes' WHERE id IN (${rest.id}::uuid, ${fromSource.id}::uuid)`;
    await sweepQueuedAgreementItems();
    expect((await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: rest.id } })).status).toBe('queued');
    expect((await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: fromSource.id } })).status).toBe('failed');
  });

  it('rejects an Idempotency-Key longer than the 128 character column', async () => {
    const long = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody(), headers: { 'idempotency-key': `k${randomUUID()}`.padEnd(129, 'x') } });
    expect(long.statusCode, long.body).toBe(400);
    const max = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody(), headers: { 'idempotency-key': `k${randomUUID()}`.padEnd(128, 'x') } });
    expect(max.statusCode, max.body).toBe(202);
  });

  it('a notification failure after the outcome is saved neither requeues nor reprocesses the item', async () => {
    const res = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody() });
    const spy = vi.spyOn(prisma.notification, 'create').mockRejectedValue(new Error('notification store down'));
    try {
      const outcome = await processAgreementIngestItem(org.orgId, res.json().id);
      expect(outcome.status).toBe('drafted');
    } finally {
      spy.mockRestore();
    }
    const row = await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: res.json().id } });
    expect(row.status).toBe('drafted');
    await sweepQueuedAgreementItems();
    expect(await processAgreementIngestItem(org.orgId, row.id)).toMatchObject({ status: 'skipped' });
    expect(await prisma.msaIntakeDraft.count({ where: { orgId: org.orgId, sha256: row.sha256! } })).toBe(1);
  });

  it('a first copy that was a duplicate of an agreement file still lets changed bytes become a new version', async () => {
    const bytes = uniquePdf();
    const first = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody({ file: { base64: bytes.toString('base64') } }) });
    await processAgreementIngestItem(org.orgId, first.json().id);
    const draftId = (await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: first.json().id } })).intakeDraftId!;
    const companyId = (await prisma.company.findFirstOrThrow({ where: { orgId: org.orgId, deletedAt: null } })).id;
    const confirm = await call({ method: 'POST', url: `/msa/intake/${draftId}/confirm`, payload: { companyId, status: 'active' } });
    expect(confirm.statusCode, confirm.body).toBe(201);
    const { contractId } = confirm.json() as { contractId: string };

    const externalId = `clm-${randomUUID()}`;
    const dup = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody({ externalId, file: { base64: bytes.toString('base64') } }) });
    expect((await processAgreementIngestItem(org.orgId, dup.json().id)).status).toBe('duplicate');
    const changed = await call({ method: 'POST', url: '/ingest/agreements', payload: ingestBody({ externalId }) });
    const outcome = await processAgreementIngestItem(org.orgId, changed.json().id);
    expect(outcome).toMatchObject({ status: 'versioned', contractId });
  });

  it('keeps ingest items tenant scoped', async () => {
    const other = await prisma.org.create({ data: { clerkOrg: `org_other_${randomUUID().slice(0, 8)}`, name: 'Other tenant' } });
    try {
      const foreign = await prisma.agreementIngestItem.create({
        data: { orgId: other.id, channel: 'rest', externalSource: 'x', externalId: 'y', fileName: 'z.pdf', actorType: 'user' },
      });
      const res = await call({ method: 'GET', url: `/ingest/agreements/${foreign.id}` });
      expect(res.statusCode).toBe(404);
      expect(await processAgreementIngestItem(org.orgId, foreign.id)).toMatchObject({ status: 'skipped' });
    } finally {
      await prisma.org.delete({ where: { id: other.id } }).catch(() => undefined);
    }
  });
});

describe('agreement sources and Sync now', () => {
  it('only Admin sessions configure sources; API keys cannot', async () => {
    const payload = { kind: 'sharepoint', name: 'Legal library', config: { siteId: 'site-1', driveId: DRIVE_ID, folderPath: 'MSA' } };
    const sm = await call({ method: 'POST', url: '/msa/sources', payload, role: 'sales-manager' });
    expect(sm.statusCode, sm.body).toBe(403);
    const key = await makeKey();
    const viaKey = await server.inject({ method: 'POST', url: '/api/v1/msa/sources', headers: { 'x-api-key': key.raw }, payload });
    expect(viaKey.statusCode, viaKey.body).toBe(403);
    const bad = await call({ method: 'POST', url: '/msa/sources', payload: { kind: 'docusign', name: 'x', config: {} } });
    expect(bad.statusCode).toBe(400);
  });

  it('pulls SharePoint by delta, drafts new files, and skips them on the next run', async () => {
    const docx = fakeDocx(`Statement of work ${randomUUID()}`);
    const spPdf = uniquePdf();
    const { fetch } = fakeFetch([
      ['https://login.microsoftonline.com/', () => json({ access_token: 'tok' })],
      DRIVE_ROOT,
      [/item-msa-pfizer\/content$/, () => new Response(spPdf)],
      [/item-sow\/content$/, () => new Response(docx)],
      [/token=page2/, () => json(GRAPH_DELTA_PAGE_2)],
      [/token=next-cursor/, () => json({ value: [], '@odata.deltaLink': GRAPH_DELTA_PAGE_2['@odata.deltaLink'] })],
      [/root\/delta/, () => json(GRAPH_DELTA_PAGE_1)],
    ]);
    __setAgreementConnectionFetchForTest(fetch);
    const created = await call({
      method: 'POST',
      url: '/msa/sources',
      payload: { kind: 'sharepoint', name: 'Legal library', config: { siteId: 'site-1', driveId: DRIVE_ID, folderPath: 'MSA' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const source = created.json() as { id: string; configured: boolean };
    const run1 = await runAgreementSourceSync({ orgId: org.orgId, sourceId: source.id, runId: 'run-1' }, { fetch, env: GRAPH_ENV });
    expect(run1.state, run1.reasons.join(';')).toBe('completed');
    expect(run1.result?.new).toBeGreaterThanOrEqual(1);
    const items = await prisma.agreementIngestItem.findMany({ where: { orgId: org.orgId, sourceId: source.id } });
    expect(items.map((i) => i.externalId).sort()).toEqual(['item-msa-pfizer', 'item-sow']);
    expect(items.every((i) => i.channel === 'sharepoint' && i.externalVersion)).toBe(true);
    const saved = await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } });
    expect(saved.cursor).toContain('next-cursor');

    const run2 = await runAgreementSourceSync({ orgId: org.orgId, sourceId: source.id, runId: 'run-2' }, { fetch, env: GRAPH_ENV });
    expect(run2.state).toBe('completed');
    expect(run2.result).toMatchObject({ new: 0, updated: 0 });
    expect(await prisma.agreementIngestItem.count({ where: { orgId: org.orgId, sourceId: source.id } })).toBe(2);

    const list = await call({ method: 'GET', url: '/msa/sources' });
    expect(list.statusCode, list.body).toBe(200);
    const mine = (list.json() as { items: Array<{ id: string; lastRun: { runId: string } | null }> }).items.find((s) => s.id === source.id);
    expect(mine?.lastRun?.runId).toBe('run-2');
  });

  it('a failed download keeps the delta cursor so the next run retries it', async () => {
    const { fetch } = fakeFetch([
      ['https://login.microsoftonline.com/', () => json({ access_token: 'tok' })],
      DRIVE_ROOT,
      [/\/content$/, () => new Response('busy', { status: 503 })],
      [/token=page2/, () => json(GRAPH_DELTA_PAGE_2)],
      [/root\/delta/, () => json(GRAPH_DELTA_PAGE_1)],
    ]);
    __setAgreementConnectionFetchForTest(fetch);
    const created = await call({
      method: 'POST',
      url: '/msa/sources',
      payload: { kind: 'sharepoint', name: 'Flaky library', config: { siteId: 'site-2', driveId: 'b!fixture-drive-flaky', folderPath: 'MSA' } },
    });
    const source = created.json() as { id: string };
    const run = await runAgreementSourceSync({ orgId: org.orgId, sourceId: source.id, runId: 'flaky-1' }, { fetch, env: GRAPH_ENV });
    expect(run.state).toBe('completed');
    expect(run.result?.failed).toBeGreaterThanOrEqual(1);
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBeNull();
  });

  it('Sync now answers 202 with a deterministic run per Idempotency-Key', async () => {
    __setAgreementConnectionFetchForTest(
      fakeFetch([
        ['https://account-d.docusign.com/oauth/token', () => json({ access_token: 'ds', refresh_token: `r-${randomUUID()}` })],
        ['https://account-d.docusign.com/oauth/userinfo', () => json({ accounts: [{ account_id: 'acct', base_uri: 'https://demo.docusign.net', is_default: true }] })],
      ]).fetch,
    );
    const created = await call({
      method: 'POST',
      url: '/msa/sources',
      payload: { kind: 'docusign', name: 'Signed MSAs', config: { keyword: 'MSA' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { id: string }).id;
    {
      const key = `sync-${randomUUID()}`;
      const a = await call({ method: 'POST', url: `/msa/sources/${id}/sync`, headers: { 'idempotency-key': key } });
      expect(a.statusCode, a.body).toBe(202);
      const b = await call({ method: 'POST', url: `/msa/sources/${id}/sync`, headers: { 'idempotency-key': key } });
      expect(b.json().runId).toBe(a.json().runId);
      expect(enqueued.filter((e) => e.kind === 'sync')).toHaveLength(1);
      const other = await call({ method: 'POST', url: `/msa/sources/${id}/sync`, headers: { 'idempotency-key': `sync-${randomUUID()}` } });
      expect(other.json().runId).toBe(a.json().runId);
      expect(enqueued.filter((e) => e.kind === 'sync')).toHaveLength(1);
      const poll = await call({ method: 'GET', url: `/msa/sources/${id}/runs/${a.json().runId}` });
      expect(poll.json()).toMatchObject({ state: 'queued' });
      const audit = await prisma.auditLog.findFirst({ where: { orgId: org.orgId, action: 'sync_now.start', targetId: id } });
      expect(audit).not.toBeNull();
      const denied = await call({ method: 'POST', url: `/msa/sources/${id}/sync`, role: 'sales-manager' });
      expect(denied.statusCode).toBe(403);
      const tooLong = await call({ method: 'POST', url: `/msa/sources/${id}/sync`, headers: { 'idempotency-key': `s${randomUUID()}`.padEnd(129, 'y') } });
      expect(tooLong.statusCode, tooLong.body).toBe(400);
    }
  });

  it('run polling shows a run lost for 30 minutes as failed', async () => {
    const source = await prisma.agreementSource.create({
      data: { orgId: org.orgId, kind: 'docusign', name: 'Lost run', config: { keyword: 'MSA' }, createdById: (await prisma.user.findFirstOrThrow({ where: { orgId: org.orgId } })).id },
    });
    const runId = `lost-${randomUUID().slice(0, 8)}`;
    await prisma.agreementSource.update({
      where: { id: source.id },
      data: { lastRunId: runId, lastResult: { runId, sourceId: source.id, state: 'running', startedAt: null, finishedAt: null, result: null, reasons: [] } },
    });
    await prisma.$executeRaw`UPDATE agreement_sources SET updated_at = now() - interval '31 minutes' WHERE id = ${source.id}::uuid`;
    const poll = await call({ method: 'GET', url: `/msa/sources/${source.id}/runs/${runId}` });
    expect(poll.statusCode, poll.body).toBe(200);
    expect(poll.json()).toMatchObject({ state: 'failed', reasons: ['The run did not finish; start it again'] });
  });

  it('pulls completed DocuSign envelopes with counterparty and signed date', async () => {
    const source = await prisma.agreementSource.create({
      data: { orgId: org.orgId, kind: 'docusign', name: 'Envelopes', config: { keyword: 'MSA' }, createdById: (await prisma.user.findFirstOrThrow({ where: { orgId: org.orgId }, orderBy: { createdAt: 'asc' } })).id },
    });
    const { generateKeyPairSync } = await import('node:crypto');
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const env = {
      DOCUSIGN_INTEGRATION_KEY: 'ik',
      DOCUSIGN_USER_ID: 'u',
      DOCUSIGN_PRIVATE_KEY: Buffer.from(pem).toString('base64'),
      DOCUSIGN_ACCOUNT_ID: 'acct',
      DOCUSIGN_BASE_URL: 'https://demo.docusign.net',
      AGREEMENT_SOURCES_SINGLE_TENANT: 'true',
    };
    const first = uniquePdf();
    const second = uniquePdf();
    const { fetch } = fakeFetch([
      ['https://account-d.docusign.com/oauth/token', () => json({ access_token: 'ds' })],
      [/env-pfizer-001\/documents\/combined$/, () => new Response(first)],
      [/env-other-002\/documents\/combined$/, () => new Response(second)],
      [/\/envelopes\?/, () => json(DOCUSIGN_ENVELOPES)],
    ]);
    const run = await runAgreementSourceSync({ orgId: org.orgId, sourceId: source.id, runId: 'ds-1' }, { fetch, env });
    expect(run.state, run.reasons.join(';')).toBe('completed');
    const item = await prisma.agreementIngestItem.findFirstOrThrow({ where: { sourceId: source.id, externalId: 'env-pfizer-001' } });
    expect(item.metadata).toMatchObject({ counterparty: 'Pfizer Inc.', signedAt: '2026-09-30T15:00:00Z' });
    const after = await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } });
    expect(after.cursor).toBe('2026-10-01T10:00:00Z');
  });
});
