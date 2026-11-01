/**
 * MARS routes and read-only tools: flag off = 404, webhook HMAC, admin-only
 * sync, tools/list, list_meetings visibility, list_contacts dedupe + recency,
 * suggest_org_chart RBAC and chart comparison, scope isolation, audit.
 */
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import type { MeetingIntelJob } from '@bidstack/shared';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { __setMeetingIntelEnqueueForTest } from '../queues/meeting-intel.js';
import { verifyMarsSignature } from '../routes/mars.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `mars${Date.now()}`;
const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);
let server: FastifyInstance;
let org = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
const prevEnv: Record<string, string | undefined> = {};
let adminId = '';
let nw = '';
const queued: MeetingIntelJob[] = [];
const SECRET = 'test-webhook-secret';

type Inj = { method: 'GET' | 'POST'; url: string; payload?: unknown; role?: string; headers?: Record<string, string> };
const call = ({ method, url, payload, role, headers }: Inj) =>
  server.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: typeof payload === 'string' ? payload : (payload as object) } : {}),
    headers: { ...(role ? { 'x-bidstack-e2e-role': role } : {}), ...(headers ?? {}) },
  });
const tool = (name: string, args: Record<string, unknown>, role?: string) =>
  call({ method: 'POST', url: `/mars/tools/${name}`, payload: { arguments: args }, ...(role ? { role } : {}) });

function setEnv(k: string, v: string | undefined) {
  if (!(k in prevEnv)) prevEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

async function marsMeeting(k: string, heldAt: Date, visibility: 'account_team' | 'org', people: Array<{ name: string; email?: string; title: string; seniority: string; linkedinUrl?: string; reportsTo?: { name: string } }>) {
  const externalId = `${TAG}-${k}:v1`;
  const m = await prisma.meetingIntel.create({
    data: {
      orgId: org.orgId,
      companyId: nw,
      title: `${TAG} ${k}`,
      heldAt,
      visibility,
      dedupeKey: `${TAG}-${k}`.padEnd(20, 'x'),
      challenges: ['Legacy warehouse'],
      sources: { create: [{ orgId: org.orgId, source: 'mars', externalId }] },
      attendees: {
        create: [
          ...people.map((p) => ({ orgId: org.orgId, name: p.name, email: p.email ?? null, title: p.title, seniority: p.seniority as never })),
          { orgId: org.orgId, name: 'Our KAM', isInternal: true, userId: adminId },
        ],
      },
    },
  });
  await prisma.meetingIngestItem.create({
    data: {
      orgId: org.orgId,
      source: 'mars',
      externalId,
      status: 'processed',
      meetingIntelId: m.id,
      payload: { externalId, title: m.title, heldAt: heldAt.toISOString(), attendees: people.map(({ seniority: _s, ...p }) => p), challenges: [], similarProjects: [], opportunities: [], nextSteps: [] },
    },
  });
  return m.id;
}

beforeAll(async () => {
  setEnv('BIDSTACK_ALLOW_STUB_ROLE_HEADER', 'true');
  setEnv('MARS_INTEGRATION_ENABLED', undefined);
  org = await createIsolatedOrg('mars');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  __setMeetingIntelEnqueueForTest(async (j) => (queued.push(j), `job-${queued.length}`));
  adminId = (await prisma.user.findFirstOrThrow({ where: { orgId: org.orgId }, orderBy: { createdAt: 'asc' } })).id;
  nw = (await prisma.company.create({ data: { orgId: org.orgId, name: `${TAG} Northwind Energy`, countryCode: 'GB', keyAccountOwnerId: adminId } })).id;
  const ceo = { name: 'Helen Marsh', email: `helen.${TAG}@nw.example`, title: 'Chief Executive Officer', seniority: 'c_level' };
  const cio = { name: 'Priya Natarajan', email: `priya.${TAG}@nw.example`, title: 'Chief Information Officer', seniority: 'c_level' };
  const vp = { name: 'Lukas Brandt', email: `lukas.${TAG}@nw.example`, title: 'VP Data', seniority: 'vp', linkedinUrl: 'https://www.linkedin.com/in/lukas-brandt-example' };
  await marsMeeting('m1', daysAgo(60), 'org', [ceo, cio]);
  await marsMeeting('m2', daysAgo(10), 'org', [cio, vp, { name: 'Sofia Ricci', title: 'Director of Cloud Infrastructure', seniority: 'director', reportsTo: { name: 'Priya Natarajan' } }]);
  // Same person seen by LinkedIn only, and a team-only meeting
  await marsMeeting('m3', daysAgo(2), 'account_team', [{ name: 'L. Brandt', title: 'VP Data', seniority: 'vp', linkedinUrl: 'https://linkedin.com/in/Lukas-Brandt-example/' }]);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setMeetingIntelEnqueueForTest(null);
  await server?.close();
  restoreAuth?.();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  invalidateAccessScope(org.orgId);
  if (org.orgId) await dropIsolatedOrg(org.orgId);
});

describe('verifyMarsSignature', () => {
  const ts = String(Math.floor(NOW / 1000));
  const sig = (body: string, t = ts, secret = SECRET) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  it('accepts a fresh, correct signature only', () => {
    expect(verifyMarsSignature('{"a":1}', ts, sig('{"a":1}'), SECRET, NOW)).toBe(true);
    expect(verifyMarsSignature('{"a":1}', ts, `sha256=${sig('{"a":1}')}`, SECRET, NOW)).toBe(true);
    expect(verifyMarsSignature('{"a":2}', ts, sig('{"a":1}'), SECRET, NOW)).toBe(false);
    expect(verifyMarsSignature('{"a":1}', ts, sig('{"a":1}', ts, 'other'), SECRET, NOW)).toBe(false);
    expect(verifyMarsSignature('{"a":1}', ts, sig('{"a":1}'), SECRET, NOW + 10 * 60_000)).toBe(false);
    expect(verifyMarsSignature('{"a":1}', undefined, sig('{"a":1}'), SECRET, NOW)).toBe(false);
    expect(verifyMarsSignature('{"a":1}', ts, 'zz', SECRET, NOW)).toBe(false);
  });
});

describe('feature flag', () => {
  it('every MARS route is 404 while the flag is off', async () => {
    expect((await call({ method: 'GET', url: '/mars/status' })).statusCode).toBe(404);
    expect((await call({ method: 'GET', url: '/mars/tools' })).statusCode).toBe(404);
    expect((await call({ method: 'POST', url: '/mars/webhook', payload: {} })).statusCode).toBe(404);
    expect((await tool('list_meetings', { accountId: nw })).statusCode).toBe(404);
  });
});

describe('with the flag on', () => {
  beforeAll(() => setEnv('MARS_INTEGRATION_ENABLED', 'true'));

  it('status, then admin-only sync creates the connection and enqueues a pull', async () => {
    const st = await call({ method: 'GET', url: '/mars/status' });
    expect(st.statusCode).toBe(200);
    expect(st.json()).toMatchObject({ source: 'mars', status: 'not_connected' });
    clearRbacDecisionCacheForTest();
    expect((await call({ method: 'POST', url: '/mars/sync', role: 'account-executive' })).statusCode).toBe(403);
    const r = await call({ method: 'POST', url: '/mars/sync' });
    expect(r.statusCode).toBe(202);
    expect(queued.at(-1)).toMatchObject({ kind: 'mars-sync', orgId: org.orgId, reason: 'manual' });
    expect((await call({ method: 'GET', url: '/mars/status' })).json()).toMatchObject({ status: 'connected' });
  });

  it('webhook: 404 without a secret, 401 on a bad signature, 202 and a nudge when signed', async () => {
    const body = JSON.stringify({ type: 'entry.updated', entryId: 'mars-1002', occurredAt: new Date(NOW).toISOString() });
    const headers = { 'content-type': 'application/json' };
    expect((await call({ method: 'POST', url: '/mars/webhook', payload: body, headers })).statusCode).toBe(404);
    setEnv('MARS_WEBHOOK_SECRET', SECRET);
    setEnv('MARS_ORG_ID', org.orgId);
    const ts = String(Math.floor(Date.now() / 1000));
    expect((await call({ method: 'POST', url: '/mars/webhook', payload: body, headers: { ...headers, 'x-mars-timestamp': ts, 'x-mars-signature': 'f'.repeat(64) } })).statusCode).toBe(401);
    const sig = createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
    const before = queued.length;
    const ok = await call({ method: 'POST', url: '/mars/webhook', payload: body, headers: { ...headers, 'x-mars-timestamp': ts, 'x-mars-signature': `sha256=${sig}` } });
    expect(ok.statusCode, ok.body).toBe(202);
    expect(queued.length).toBe(before + 1);
    expect(queued.at(-1)).toMatchObject({ kind: 'mars-sync', reason: 'webhook' });
    expect(JSON.stringify(ok.json())).not.toContain(SECRET);
  });

  it('tools/list describes three read-only tools', async () => {
    const r = await call({ method: 'GET', url: '/mars/tools' });
    expect(r.statusCode).toBe(200);
    const tools = r.json().tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
    expect(tools.map((t) => t.name)).toEqual(['list_meetings', 'list_contacts', 'suggest_org_chart']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('rejects unknown tools and bad input', async () => {
    expect((await tool('drop_tables', { accountId: nw })).statusCode).toBe(400);
    expect((await tool('list_meetings', { accountId: 'nope' })).statusCode).toBe(400);
    expect((await tool('list_meetings', { accountId: nw, extra: true })).statusCode).toBe(400);
  });

  it('list_meetings: admin sees team-only meetings, others only what visibility allows', async () => {
    const admin = await tool('list_meetings', { accountId: nw, source: 'mars' });
    expect(admin.statusCode).toBe(200);
    const body = admin.json();
    expect(body.isError).toBe(false);
    expect(body.structuredContent.meetings).toHaveLength(3);
    expect(JSON.parse(body.content[0].text).meetings).toHaveLength(3);
    expect(body.structuredContent.meetings[0].sources).toEqual(['mars']);

    clearRbacDecisionCacheForTest();
    const ae = await tool('list_meetings', { accountId: nw }, 'account-executive');
    expect(ae.statusCode).toBe(200);
    const titles = ae.json().structuredContent.meetings.map((m: { title: string }) => m.title);
    expect(titles).not.toContain(`${TAG} m3`);
    expect(titles).toContain(`${TAG} m2`);
  });

  it('list_contacts: one row per person, recency badge, opaque key', async () => {
    const r = await tool('list_contacts', { accountId: nw });
    expect(r.statusCode, r.body).toBe(200);
    const contacts = r.json().structuredContent.contacts as Array<{ name: string; key: string; email: string | null; linkedinUrl: string | null; meetingCount: number; recency: string }>;
    const lukas = contacts.filter((c) => c.name.includes('Brandt'));
    expect(lukas).toHaveLength(1);
    expect(lukas[0]).toMatchObject({ meetingCount: 2, recency: 'recent', email: `lukas.${TAG}@nw.example` });
    expect(lukas[0]!.linkedinUrl).toContain('lukas-brandt-example');
    expect(contacts.find((c) => c.name === 'Helen Marsh')?.recency).toBe('warm');
    for (const c of contacts) {
      expect(c.key).toMatch(/^p_[a-f0-9]{20}$/);
      expect(c.key).not.toContain('@');
    }
  });

  it('without contacts:read or orgchart:read: no email or LinkedIn, no suggestions', async () => {
    // Throwaway org: narrow its Presales role to meetings:read only.
    await prisma.rolePermission.deleteMany({
      where: { orgId: org.orgId, role: { name: 'Presales' }, permission: { key: { in: ['contacts:read', 'orgchart:read'] } } },
    });
    clearRbacDecisionCacheForTest();
    const r = await tool('list_contacts', { accountId: nw }, 'presales');
    expect(r.statusCode, r.body).toBe(200);
    const contacts = r.json().structuredContent.contacts as Array<{ email: string | null; linkedinUrl: string | null }>;
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.every((c) => c.email === null && c.linkedinUrl === null)).toBe(true);
    expect(r.body).not.toContain('@nw.example');
    expect((await tool('suggest_org_chart', { accountId: nw }, 'presales')).statusCode).toBe(403);
  });

  it('suggest_org_chart: suggests from MARS sightings and never writes', async () => {
    const nodesBefore = await prisma.orgChartNode.count({ where: { orgId: org.orgId } });
    const r = await tool('suggest_org_chart', { accountId: nw, minConfidence: 'low' });
    expect(r.statusCode).toBe(200);
    const out = r.json().structuredContent;
    const sofia = out.suggestions.find((s: { personName: string }) => s.personName === 'Sofia Ricci');
    expect(sofia).toMatchObject({ managerName: 'Priya Natarajan', confidence: 'high', status: 'new_node' });
    expect(out.suggestions.find((s: { personName: string }) => s.personName === 'Lukas Brandt')?.managerName).toBe('Priya Natarajan');
    expect(out.howToApply).toContain('/org-chart/nodes/:nodeId/move');
    expect(await prisma.orgChartNode.count({ where: { orgId: org.orgId } })).toBe(nodesBefore);
  });

  it('an account outside the caller scope is not_found, and every call is audited', async () => {
    const other = await createIsolatedOrg('mars-b');
    try {
      const foreign = (await prisma.company.create({ data: { orgId: other.orgId, name: `${TAG} Foreign` } })).id;
      expect((await tool('list_meetings', { accountId: foreign })).statusCode).toBe(404);
    } finally {
      await dropIsolatedOrg(other.orgId);
    }
    const audits = await prisma.auditLog.findMany({ where: { orgId: org.orgId, action: { startsWith: 'meeting_intel.tool.' } }, take: 50 });
    expect(new Set(audits.map((a) => a.action))).toEqual(new Set(['meeting_intel.tool.list_meetings', 'meeting_intel.tool.list_contacts', 'meeting_intel.tool.suggest_org_chart']));
    expect(audits.every((a) => a.targetId === nw)).toBe(true);
  });
});
