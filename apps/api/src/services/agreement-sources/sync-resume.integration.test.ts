/**
 * Agreement source sync (slice 13a review): resumable SharePoint paging past
 * the per-run budget, and retryable versus definitive failures for SharePoint
 * and DocuSign (backoff, cursor held, dead-letter after the cap).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';
import { encryptToken } from '@bidstack/shared/token-crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { __setStorageForTest } from '../../storage/index.js';
import { fakeFetch, json } from '../../test-support/agreement-source-fixtures.js';
import { createIsolatedOrg, dropIsolatedOrg } from '../../test-support/isolated-org.js';
import { fakeDocx, makeFakeStorage, type FakeStorage } from '../../test-support/msa-storage.js';
import { syntheticNorthwindMsaPdf } from '../../test-support/synthetic-msa-pdf.js';
import { MAX_SOURCE_ATTEMPTS, runAgreementSourceSync } from './sync.js';

const TENANT = '11111111-2222-4333-8444-555555555555';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const ENV = {
  MICROSOFT_TENANT_ID: TENANT,
  MICROSOFT_GRAPH_CLIENT_ID: 'client-fixture',
  MICROSOFT_GRAPH_CLIENT_SECRET: 'not-a-secret',
  DOCUSIGN_INTEGRATION_KEY: 'ik-fixture',
  DOCUSIGN_CLIENT_SECRET: 'not-a-secret',
};

let orgId = '';
let userId = '';
let storage: FakeStorage;
let pdf: Buffer;
const savedKey = process.env.INTEGRATION_TOKEN_KEY;

function uniquePdf(): Buffer {
  return Buffer.concat([pdf, Buffer.from(`\n% ${randomUUID()}\n`)]);
}

async function connection(provider: 'sharepoint' | 'docusign') {
  return prisma.agreementConnection.upsert({
    where: { orgId_provider: { orgId, provider } },
    create: {
      orgId,
      provider,
      status: 'connected',
      createdById: userId,
      ...(provider === 'sharepoint'
        ? { externalTenantId: TENANT }
        : { accountId: 'acct-1', baseUri: 'https://demo.docusign.net', secretEncrypted: encryptToken('refresh-0') }),
    },
    update: {},
  });
}

async function sharePointSource(driveId: string) {
  const conn = await connection('sharepoint');
  return prisma.agreementSource.create({
    data: { orgId, kind: 'sharepoint', name: `Drive ${driveId}`, config: { siteId: 'site-1', driveId }, connectionId: conn.id, createdById: userId },
  });
}

/** A drive delta feed of n agreement files split into pages of pageSize. */
function bulkFeed(driveId: string, n: number, pageSize = 100) {
  const pages = Math.ceil(n / pageSize);
  const base = `${GRAPH}/drives/${encodeURIComponent(driveId)}/root/delta`;
  const page = (p: number) => {
    const value = [];
    for (let i = p * pageSize; i < Math.min(n, (p + 1) * pageSize); i += 1) {
      value.push({
        id: `${driveId}-f${i}`,
        name: `Agreement ${i}.pdf`,
        size: 1000,
        cTag: `"c:{${i}},1"`,
        file: { mimeType: 'application/pdf' },
        parentReference: { path: '/drive/root:/MSA' },
      });
    }
    return p + 1 < pages
      ? { value, '@odata.nextLink': `${base}?token=p${p + 1}` }
      : { value, '@odata.deltaLink': `${base}?token=final-${n}` };
  };
  return { page, finalLink: `${base}?token=final-${n}` };
}

function graphRoutes(driveId: string, feed: { page: (p: number) => unknown }, download: (id: string) => Response) {
  return fakeFetch([
    ['https://login.microsoftonline.com/', () => json({ access_token: 'tok' })],
    [/\/root\?\$select=id,sharepointIds/, () => json({ id: 'root', sharepointIds: { tenantId: TENANT } })],
    [/\/items\/([^/]+)\/content$/, (url) => download(decodeURIComponent(url.match(/\/items\/([^/]+)\/content$/)![1]!))],
    [/token=p(\d+)$/, (url) => json(feed.page(Number(url.match(/token=p(\d+)$/)![1])))],
    [/token=final-/, () => json({ value: [], '@odata.deltaLink': `${GRAPH}/drives/${encodeURIComponent(driveId)}/root/delta?token=after` })],
    [/root\/delta/, () => json(feed.page(0))],
  ]);
}

beforeAll(async () => {
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString('hex');
  _resetIntegrationTokenKey();
  const org = await createIsolatedOrg('agreement-sync-resume');
  orgId = org.orgId;
  await prisma.org.update({ where: { id: orgId }, data: { microsoftTenantId: TENANT } });
  userId = (await prisma.user.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: 'asc' } })).id;
  pdf = await syntheticNorthwindMsaPdf();
});

afterAll(async () => {
  __setStorageForTest(null);
  if (orgId) await dropIsolatedOrg(orgId);
  process.env.INTEGRATION_TOKEN_KEY = savedKey;
  _resetIntegrationTokenKey();
});

beforeEach(() => {
  storage = makeFakeStorage('s3');
  __setStorageForTest(storage);
});

describe('SharePoint paging past the per-run budget', () => {
  async function pullAll(n: number, expectedRuns: number) {
    const driveId = `b!bulk-${n}-${randomUUID().slice(0, 6)}`;
    const source = await sharePointSource(driveId);
    const feed = bulkFeed(driveId, n);
    const { fetch } = graphRoutes(driveId, feed, () => new Response(uniquePdf()));
    const cursors: Array<string | null> = [];
    for (let run = 1; run <= expectedRuns; run += 1) {
      const res = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: `bulk-${n}-${run}` }, { fetch, env: ENV });
      expect(res.state, res.reasons.join(';')).toBe('completed');
      cursors.push((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor);
    }
    const landed = await prisma.agreementIngestItem.findMany({ where: { orgId, sourceId: source.id }, select: { externalId: true }, take: 1000 });
    return { landed: new Set(landed.map((l) => l.externalId)), cursors, finalLink: feed.finalLink, source };
  }

  it('lands all 201 files over two runs; the cursor moves only after the feed is read', async () => {
    const { landed, cursors, finalLink } = await pullAll(201, 2);
    expect(landed.size).toBe(201);
    expect(cursors).toEqual([null, finalLink]);
  }, 300_000);

  it('lands all 450 files over three runs and resumes from the page it stopped on', async () => {
    const { landed, cursors, finalLink, source } = await pullAll(450, 3);
    expect(landed.size).toBe(450);
    expect(cursors).toEqual([null, null, finalLink]);
    const saved = await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } });
    expect(saved.progress).toBeNull();
  }, 600_000);
});

describe('retryable versus definitive failures', () => {
  function failStorageTimes(times: number) {
    let left = times;
    const put = storage.putObject!.bind(storage);
    storage.putObject = async (key, body, contentType) => {
      if (left > 0) {
        left -= 1;
        throw new Error('storage unavailable');
      }
      return put(key, body, contentType);
    };
  }

  it('SharePoint: a storage outage keeps the cursor, retries with backoff, then lands the file', async () => {
    const driveId = `b!transient-${randomUUID().slice(0, 6)}`;
    const source = await sharePointSource(driveId);
    const feed = bulkFeed(driveId, 1);
    const { fetch } = graphRoutes(driveId, feed, () => new Response(uniquePdf()));
    failStorageTimes(1);
    const t0 = new Date('2026-11-07T10:00:00Z');
    const run1 = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'sp-t-1' }, { fetch, env: ENV, now: () => t0 });
    expect(run1.result?.failed).toBe(1);
    const item = await prisma.agreementIngestItem.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(item.status).toBe('failed');
    expect(item.nextAttemptAt!.getTime()).toBeGreaterThan(t0.getTime());
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBeNull();

    // Not due yet: nothing is retried and the cursor still waits.
    const early = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'sp-t-2' }, { fetch, env: ENV, now: () => t0 });
    expect(early.result?.new).toBe(0);
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBeNull();

    const later = new Date(item.nextAttemptAt!.getTime() + 1000);
    const run2 = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'sp-t-3' }, { fetch, env: ENV, now: () => later });
    expect(run2.result?.new).toBe(1);
    expect((await prisma.agreementIngestItem.findFirstOrThrow({ where: { id: item.id } })).status).toBe('drafted');
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toContain('token=');
  }, 120_000);

  it('SharePoint: a file that is gone (404) is rejected and does not hold the cursor', async () => {
    const driveId = `b!gone-${randomUUID().slice(0, 6)}`;
    const source = await sharePointSource(driveId);
    const feed = bulkFeed(driveId, 1);
    const { fetch } = graphRoutes(driveId, feed, () => new Response('gone', { status: 404 }));
    const run = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'sp-d-1' }, { fetch, env: ENV });
    expect(run.state).toBe('completed');
    const item = await prisma.agreementIngestItem.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(item.status).toBe('rejected');
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBe(feed.finalLink);
  }, 60_000);

  it('SharePoint: a file the parser cannot read is rejected, not retried', async () => {
    const driveId = `b!corrupt-${randomUUID().slice(0, 6)}`;
    const source = await sharePointSource(driveId);
    const feed = bulkFeed(driveId, 1);
    const { fetch } = graphRoutes(driveId, feed, () => new Response(fakeDocx(`broken ${randomUUID()}`)));
    await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'sp-c-1' }, { fetch, env: ENV });
    const item = await prisma.agreementIngestItem.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(item.status).toBe('rejected');
    expect(item.nextAttemptAt).toBeNull();
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBe(feed.finalLink);
  }, 60_000);

  it('SharePoint: a file that keeps failing is dead-lettered after the cap and releases the cursor', async () => {
    const driveId = `b!dead-${randomUUID().slice(0, 6)}`;
    const source = await sharePointSource(driveId);
    const feed = bulkFeed(driveId, 1);
    const { fetch } = graphRoutes(driveId, feed, () => new Response('busy', { status: 503 }));
    let now = new Date('2026-11-07T10:00:00Z');
    for (let run = 1; run <= MAX_SOURCE_ATTEMPTS; run += 1) {
      await runAgreementSourceSync({ orgId, sourceId: source.id, runId: `sp-dl-${run}` }, { fetch, env: ENV, now: () => now });
      now = new Date(now.getTime() + 2 * 24 * 60 * 60_000);
    }
    const item = await prisma.agreementIngestItem.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(item.attempts).toBe(MAX_SOURCE_ATTEMPTS);
    expect(item.status).toBe('failed');
    expect(item.deadLetteredAt).not.toBeNull();
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBe(feed.finalLink);
    const audit = await prisma.auditLog.findFirst({ where: { orgId, targetId: item.id, action: 'agreement.ingest.dead_lettered' } });
    expect(audit).not.toBeNull();
  }, 120_000);

  function docuSignRoutes(download: (envelopeId: string) => Response) {
    return fakeFetch([
      ['https://account-d.docusign.com/oauth/token', () => json({ access_token: 'ds', refresh_token: `refresh-${randomUUID()}` })],
      ['https://account-d.docusign.com/oauth/userinfo', () => json({ accounts: [{ account_id: 'acct-1', base_uri: 'https://demo.docusign.net', is_default: true }] })],
      [/\/envelopes\/([^/]+)\/documents\/combined$/, (url) => download(url.match(/\/envelopes\/([^/]+)\/documents\/combined$/)![1]!)],
      [
        /\/envelopes\?/,
        () =>
          json({
            resultSetSize: '1',
            totalSetSize: '1',
            envelopes: [{ envelopeId: 'env-retry-1', status: 'completed', emailSubject: 'MSA retry', completedDateTime: '2026-10-05T10:00:00Z' }],
          }),
      ],
    ]);
  }

  async function docuSignSource() {
    const conn = await connection('docusign');
    // One DocuSign source per test, so each has its own envelope history.
    await prisma.agreementIngestItem.deleteMany({ where: { orgId, externalSource: 'docusign:acct-1' } });
    return prisma.agreementSource.create({
      data: { orgId, kind: 'docusign', name: 'Envelopes', config: { keyword: 'MSA' }, connectionId: conn.id, createdById: userId },
    });
  }

  it('DocuSign: a storage outage keeps the cursor and the retry lands the envelope', async () => {
    const source = await docuSignSource();
    const { fetch } = docuSignRoutes(() => new Response(uniquePdf()));
    failStorageTimes(1);
    const t0 = new Date('2026-11-07T10:00:00Z');
    const run1 = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'ds-t-1' }, { fetch, env: ENV, now: () => t0 });
    expect(run1.result?.failed, run1.reasons.join(';')).toBe(1);
    const item = await prisma.agreementIngestItem.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(item.status).toBe('failed');
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBeNull();
    const later = new Date(item.nextAttemptAt!.getTime() + 1000);
    const run2 = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'ds-t-2' }, { fetch, env: ENV, now: () => later });
    expect(run2.result?.new).toBe(1);
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBe('2026-10-05T10:00:00Z');
  }, 60_000);

  it('DocuSign: an envelope that is gone (404) is rejected and the cursor moves on', async () => {
    const source = await docuSignSource();
    const { fetch } = docuSignRoutes(() => new Response('gone', { status: 404 }));
    const run = await runAgreementSourceSync({ orgId, sourceId: source.id, runId: 'ds-d-1' }, { fetch, env: ENV });
    expect(run.state).toBe('completed');
    const item = await prisma.agreementIngestItem.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(item.status).toBe('rejected');
    expect((await prisma.agreementSource.findFirstOrThrow({ where: { id: source.id } })).cursor).toBe('2026-10-05T10:00:00Z');
  }, 60_000);
});
