import { createHash, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

// End to end over the real DB: an external CRM pushes a batch with an API key,
// the rows land on the right company and opportunity, a replay updates or
// skips instead of duplicating, and the account page summary reflects them.
describe('POST /api/v1/ingest/activities', () => {
  let server: FastifyInstance;
  let orgId: string;
  let restoreAuth: () => void;
  let company: { id: string; domain: string };
  let otherCompanyId: string;
  let opportunity: { id: string; code: string };
  let rawKey: string;
  let scopedKey: string;
  let readOnlyKey: string;
  const run = randomUUID().slice(0, 8);

  async function makeKey(data: {
    scopes: string[];
    readOnly?: boolean;
    unrestrictedScope?: boolean;
    companyIds?: string[];
  }): Promise<string> {
    const raw = `bidstack_test_ingest_${randomUUID()}`;
    await prisma.apiKey.create({
      data: {
        orgId,
        name: `ingest test ${run}`,
        prefix: raw.slice(0, 12),
        hashedKey: createHash('sha256').update(raw).digest('hex'),
        scopes: data.scopes,
        readOnly: data.readOnly ?? false,
        unrestrictedScope: data.unrestrictedScope ?? true,
        companyIds: data.companyIds ?? [],
      },
    });
    return raw;
  }

  beforeAll(async () => {
    const org = await createIsolatedOrg('ingest');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

    const c = await prisma.company.create({
      data: { orgId, name: `Ingest Co ${run}`, domain: `ingest-${run}.example.com` },
    });
    company = { id: c.id, domain: c.domain! };
    const other = await prisma.company.create({
      data: { orgId, name: `Other Co ${run}`, domain: `other-${run}.example.com` },
    });
    otherCompanyId = other.id;
    const opp = await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-${run}`,
        customer: c.name,
        name: 'Ingest deal',
        stage: 's1_ongoing',
        valueMicros: 1_000_000,
        probability: 20,
        intel: {},
        companyId: c.id,
      },
    });
    opportunity = { id: opp.id, code: opp.code };

    rawKey = await makeKey({ scopes: ['ingest:write', 'activities:read'] });
    scopedKey = await makeKey({
      scopes: ['ingest:write'],
      unrestrictedScope: false,
      companyIds: [otherCompanyId],
    });
    readOnlyKey = await makeKey({ scopes: ['ingest:write'], readOnly: true });

    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const post = (key: string, activities: unknown[], headers: Record<string, string> = {}) =>
    server.inject({
      method: 'POST',
      url: '/api/v1/ingest/activities',
      headers: { 'x-api-key': key, ...headers },
      payload: { activities },
    });

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  twoDaysAgo.setUTCHours(14, 30, 0, 0);
  const call = (externalId: string, extra: Record<string, unknown> = {}) => ({
    externalSource: 'crm-test',
    externalId,
    type: 'call',
    occurredAt: twoDaysAgo.toISOString(),
    subject: 'Discovery call',
    company: { domain: `INGEST-${run}.example.com` },
    ...extra,
  });

  it('accepts new rows mapped by domain and by opportunity code', async () => {
    const res = await post(rawKey, [
      call('a-1'),
      call('a-2', { type: 'meeting', company: undefined, opportunity: { code: opportunity.code } }),
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counts).toEqual({ accepted: 2, updated: 0, skipped: 0 });

    const rows = await prisma.activity.findMany({
      where: { orgId, metadata: { path: ['externalSource'], equals: 'crm-test' } },
      select: { entityType: true, entityId: true, type: true },
    });
    // Activity.type is a Postgres enum, so sort in JS rather than by enum order.
    rows.sort((x, y) => x.type.localeCompare(y.type));
    expect(rows).toEqual([
      { entityType: 'company', entityId: company.id, type: 'call' },
      { entityType: 'opportunity', entityId: opportunity.id, type: 'meeting' },
    ]);
  });

  it('a replay with the same content is skipped as unchanged, never duplicated', async () => {
    const res = await post(rawKey, [call('a-1')]);
    expect(res.json()).toMatchObject({
      counts: { accepted: 0, updated: 0, skipped: 1 },
      skipped: [{ index: 0, externalId: 'a-1', reason: 'unchanged' }],
    });
    const n = await prisma.activity.count({
      where: { orgId, metadata: { path: ['externalId'], equals: 'a-1' } },
    });
    expect(n).toBe(1);
  });

  it('a replay with new content updates the existing row', async () => {
    const res = await post(rawKey, [call('a-1', { subject: 'Discovery call, rescheduled' })]);
    expect(res.json().counts).toEqual({ accepted: 0, updated: 1, skipped: 0 });
    const row = await prisma.activity.findFirst({
      where: { orgId, metadata: { path: ['externalId'], equals: 'a-1' } },
      select: { subject: true },
    });
    expect(row?.subject).toBe('Discovery call, rescheduled');
  });

  it('learns a company external id once, then maps by it alone', async () => {
    const first = await post(rawKey, [
      call('b-1', { company: { domain: company.domain, externalId: `acct-${run}` } }),
    ]);
    expect(first.json().counts.accepted).toBe(1);
    const second = await post(rawKey, [call('b-2', { company: { externalId: `acct-${run}` } })]);
    expect(second.json().counts.accepted).toBe(1);
    const row = await prisma.activity.findFirst({
      where: { orgId, metadata: { path: ['externalId'], equals: 'b-2' } },
      select: { entityId: true },
    });
    expect(row?.entityId).toBe(company.id);
  });

  it('skips with a reason when the company cannot be found', async () => {
    const res = await post(rawKey, [call('c-1', { company: { domain: 'nobody.invalid' } })]);
    expect(res.json()).toMatchObject({
      counts: { skipped: 1 },
      skipped: [{ externalId: 'c-1', reason: 'company_not_found' }],
    });
  });

  it('skips a duplicate external id inside one batch', async () => {
    const res = await post(rawKey, [call('d-1'), call('d-1', { subject: 'again' })]);
    expect(res.json()).toMatchObject({
      counts: { accepted: 1, skipped: 1 },
      skipped: [{ index: 1, reason: 'duplicate_in_batch' }],
    });
  });

  it('a company-scoped key cannot write onto a company outside its allowlist', async () => {
    const res = await post(scopedKey, [call('e-1')]);
    expect(res.json()).toMatchObject({ skipped: [{ reason: 'out_of_scope' }] });
  });

  it('a read-only key is refused', async () => {
    const res = await post(readOnlyKey, [call('f-1')]);
    expect(res.statusCode).toBe(403);
  });

  it('participants never store a plaintext email: they link to a known contact or drop', async () => {
    const contact = await prisma.contact.create({
      data: {
        orgId,
        customer: 'Ingest Co',
        companyId: company.id,
        name: 'Ada Example',
        email: `ada-${run}@example.com`,
      },
    });
    const res = await post(rawKey, [
      call('g-1', {
        participants: [
          { email: `ADA-${run}@example.com` },
          { email: `stranger-${run}@example.com` },
        ],
      }),
    ]);
    expect(res.json().counts.accepted).toBe(1);
    const row = await prisma.activity.findFirst({
      where: { orgId, metadata: { path: ['externalId'], equals: 'g-1' } },
      select: { attendees: { select: { contactId: true, email: true } }, metadata: true },
    });
    expect(row?.attendees).toEqual([{ contactId: contact.id, email: null }]);
    expect(JSON.stringify(row?.metadata)).not.toContain('stranger');
  });

  it('writes one audit event per batch with the counts', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { orgId, action: 'activities.ingest' },
      orderBy: { at: 'desc' },
      select: { diff: true, targetType: true },
    });
    expect(audit?.targetType).toBe('activity_ingest');
    expect(audit?.diff).toMatchObject({ channel: 'rest', counts: expect.any(Object) });
  });

  it('replays an Idempotency-Key with the cached response', async () => {
    const key = `ingest-${run}-idem`;
    const first = await post(rawKey, [call('h-1')], { 'idempotency-key': key });
    const second = await post(rawKey, [call('h-1')], { 'idempotency-key': key });
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());
    expect(second.json().counts.accepted).toBe(1);
  });

  it('feeds the account activity summary', async () => {
    await prisma.task.create({
      data: {
        orgId,
        title: 'Overdue follow-up',
        status: 'open',
        accountId: company.id,
        dueDate: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${company.id}/activity-summary?tz=UTC&weeks=4`,
      headers: { 'x-api-key': rawKey },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.byHour).toHaveLength(24);
    expect(body.byHour[14].call).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.overdue.count).toBeGreaterThanOrEqual(1);
  });

  it('a scoped key cannot attach an activity to another account through its opportunity', async () => {
    const res = await post(scopedKey, [
      call('m-1', { company: { id: otherCompanyId }, opportunity: { id: opportunity.id } }),
    ]);
    expect(res.json().skipped).toEqual([
      expect.objectContaining({ externalId: 'm-1', reason: 'company_mismatch' }),
    ]);
  });

  it('a scoped key learns no links and cannot re-point a learned one', async () => {
    await post(scopedKey, [
      call('m-2', { company: { id: company.id, externalId: `steal-${run}` } }),
      call('m-3', { company: { id: otherCompanyId, externalId: `acct-${run}` } }),
    ]);
    const links = await prisma.externalRecordLink.findMany({
      where: { orgId, source: 'crm-test', externalId: { in: [`steal-${run}`, `acct-${run}`] } },
      select: { externalId: true, entityId: true },
    });
    expect(links).toEqual([{ externalId: `acct-${run}`, entityId: company.id }]);
  });

  it('a scoped key cannot tell a missing record from one outside its scope', async () => {
    const res = await post(scopedKey, [call('m-4', { company: { domain: 'nobody.example.org' } })]);
    expect(res.json().skipped[0].reason).toBe('out_of_scope');
  });
});
