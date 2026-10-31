/**
 * Meeting intel routes: RBAC, org/scope/account-team isolation, redaction of
 * cross-region flags, coverage and challenge rollups, manual entry, Metis
 * consent connection and token-authenticated push ingest, audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';
import type { MeetingIntelJob } from '@bidstack/shared';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { __setMeetingIntelEnqueueForTest } from '../queues/meeting-intel.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `mi${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;
let adminId = '';
let deUser = '';
const c: Record<string, string> = {};
const m: Record<string, string> = {};
let flagId = '';
const queued: MeetingIntelJob[] = [];

type Inj = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown; role?: string; headers?: Record<string, string> };
function call({ method, url, payload, role, headers }: Inj) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: { ...(role ? { 'x-bidstack-e2e-role': role } : {}), ...(headers ?? {}) },
  });
}

const HELD = new Date('2026-10-01T10:00:00.000Z');

beforeAll(async () => {
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('mi-a');
  orgB = await createIsolatedOrg('mi-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  __setMeetingIntelEnqueueForTest(async (j) => (queued.push(j), `job-${queued.length}`));
  adminId = (await prisma.user.findFirstOrThrow({ where: { orgId: orgA.orgId }, orderBy: { createdAt: 'asc' } })).id;
  deUser = (await prisma.user.create({ data: { orgId: orgA.orgId, clerkUser: `user_${TAG}_de`, email: `${TAG}.de@example.test`, name: 'DE KAM' } })).id;
  const mk = async (k: string, data: Record<string, unknown>, orgId = orgA.orgId) =>
    (c[k] = (await prisma.company.create({ data: { orgId, ...data } as never })).id);
  await mk('root', { name: `${TAG} Acme Group`, tier: 'key' });
  await mk('fr', { name: `${TAG} Acme France`, parentId: c.root, countryCode: 'FR', keyAccountOwnerId: adminId });
  await mk('de', { name: `${TAG} Acme Germany`, parentId: c.root, countryCode: 'DE', keyAccountOwnerId: deUser });
  await mk('b', { name: `${TAG} Other org co`, countryCode: 'FR' }, orgB.orgId);
  const boss = await prisma.contact.create({ data: { orgId: orgA.orgId, customer: 'Acme', name: 'Big Boss', companyId: c.fr } });
  const marie = await prisma.contact.create({
    data: { orgId: orgA.orgId, customer: 'Acme', name: 'Marie Curie', companyId: c.fr, reportsToContactId: boss.id },
  });
  const mkM = async (k: string, data: Record<string, unknown>, attendees: Array<Record<string, unknown>> = []) => {
    const orgId = (data.orgId as string) ?? orgA.orgId;
    m[k] = (
      await prisma.meetingIntel.create({
        data: {
          orgId,
          title: `${TAG} ${k}`,
          heldAt: HELD,
          dedupeKey: `${TAG}-${k}`.padEnd(20, 'x'),
          ...data,
          sources: { create: [{ orgId, source: 'abc', externalId: `${TAG}-${k}`, url: `https://abc.example/${k}` }] },
          attendees: { create: attendees.map((a) => ({ orgId, ...a })) },
        } as never,
      })
    ).id;
  };
  await mkM('fr', { companyId: c.fr, challenges: ['Legacy ERP'], nextSteps: ['Send deck'], summary: 'FR summary' }, [
    { name: 'Marie Curie', title: 'CFO', seniority: 'c_level', region: 'FR', contactId: marie.id },
    { name: 'Admin', isInternal: true, userId: adminId },
  ]);
  await mkM('deTeam', { companyId: c.de, createdById: deUser, challenges: ['Secret reorg'] }, [
    { name: 'Hans', title: 'VP Sales', seniority: 'vp', region: 'DE' },
  ]);
  await mkM('deOrg', { companyId: c.de, visibility: 'org', challenges: ['legacy erp', 'Hiring'] }, [
    { name: 'Greta', title: 'IT Manager', seniority: 'manager', region: 'DE' },
  ]);
  await mkM('other', { orgId: orgB.orgId, companyId: c.b, visibility: 'org' });
  flagId = (
    await prisma.meetingCrossRegionFlag.create({
      data: {
        orgId: orgA.orgId,
        meetingId: m.deTeam!,
        recipientUserId: adminId,
        parentCompanyId: c.root!,
        companyId: c.de!,
        ownedCompanyId: c.fr!,
        reason: 'stored reason',
        talkingPoints: [],
      },
    })
  ).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setMeetingIntelEnqueueForTest(null);
  await server?.close();
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  invalidateAccessScope(orgA.orgId);
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
  if (orgB.orgId) await dropIsolatedOrg(orgB.orgId);
});

async function withScope(userId: string, countries: string[], fn: () => Promise<void>) {
  const group = await prisma.userGroup.create({ data: { orgId: orgA.orgId, name: `${TAG}-${countries.join('')}`, scopeCountries: countries } });
  await prisma.userGroupMember.create({ data: { orgId: orgA.orgId, groupId: group.id, userId } });
  invalidateAccessScope(orgA.orgId, userId);
  try {
    await fn();
  } finally {
    await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
    await prisma.userGroup.delete({ where: { id: group.id } });
    invalidateAccessScope(orgA.orgId, userId);
  }
}

describe('RBAC', () => {
  it('SDR has no meetings:read or meetings:write', async () => {
    clearRbacDecisionCacheForTest();
    expect((await call({ method: 'GET', url: '/meeting-intel', role: 'sdr' })).statusCode).toBe(403);
    expect((await call({ method: 'GET', url: `/meeting-intel/accounts/${c.root}/coverage`, role: 'sdr' })).statusCode).toBe(403);
    expect(
      (await call({ method: 'POST', url: '/meeting-intel', role: 'sdr', payload: { companyId: c.fr, title: 'x', heldAt: HELD.toISOString(), attendees: [] } }))
        .statusCode,
    ).toBe(403);
  });
});

describe('list and detail', () => {
  it('shows org meetings and account-team meetings the caller is on, never other orgs', async () => {
    const res = await call({ method: 'GET', url: '/meeting-intel' });
    expect(res.statusCode, res.body).toBe(200);
    const ids = (res.json() as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(ids.sort()).toEqual([m.fr, m.deOrg].sort());
    const row = (res.json() as { items: Array<Record<string, unknown>> }).items.find((i) => i.id === m.fr)!;
    expect(row).toMatchObject({ topSeniority: 'c_level', attendeeCount: 2, sources: ['abc'], companyName: `${TAG} Acme France` });
    const audit = await prisma.auditLog.findFirst({ where: { orgId: orgA.orgId, action: 'meeting_intel.list' } });
    expect(audit).not.toBeNull();
  });

  it('filters by group, seniority and source', async () => {
    const byGroup = await call({ method: 'GET', url: `/meeting-intel?groupId=${c.root}&seniority=manager` });
    expect((byGroup.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([m.deOrg]);
    const byQ = await call({ method: 'GET', url: `/meeting-intel?q=${encodeURIComponent('FR summary')}` });
    expect((byQ.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([m.fr]);
  });

  it('detail carries attendees with org chart link and source links; hidden rows are 404', async () => {
    const res = await call({ method: 'GET', url: `/meeting-intel/${m.fr}` });
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json() as { attendees: Array<Record<string, unknown>>; sourceLinks: Array<Record<string, unknown>>; transcript: unknown };
    expect(d.attendees.find((a) => a.name === 'Marie Curie')!.reportsToContactId).toBeTruthy();
    expect(d.sourceLinks[0]).toMatchObject({ source: 'abc', url: 'https://abc.example/fr' });
    expect(d.transcript).toBeNull();
    expect((await call({ method: 'GET', url: `/meeting-intel/${m.deTeam}` })).statusCode).toBe(404);
    expect((await call({ method: 'GET', url: `/meeting-intel/${m.other}` })).statusCode).toBe(404);
    expect(await prisma.auditLog.count({ where: { orgId: orgA.orgId, action: 'meeting_intel.view', targetId: m.fr } })).toBe(1);
  });

  it('a user outside the account team only sees org-visible meetings', async () => {
    clearRbacDecisionCacheForTest();
    const res = await call({ method: 'GET', url: '/meeting-intel', role: 'sales-manager' });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([m.deOrg]);
    expect((await call({ method: 'GET', url: `/meeting-intel/${m.fr}`, role: 'sales-manager' })).statusCode).toBe(404);
  });

  it('access scope hides out-of-country accounts even when org-visible', async () => {
    await withScope(adminId, ['FR'], async () => {
      const res = await call({ method: 'GET', url: '/meeting-intel' });
      expect((res.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([m.fr]);
      expect((await call({ method: 'GET', url: `/meeting-intel/${m.deOrg}` })).statusCode).toBe(404);
    });
  });
});

describe('rollups', () => {
  it('coverage map counts region x seniority and lists senior gaps', async () => {
    const res = await call({ method: 'GET', url: `/meeting-intel/accounts/${c.root}/coverage?windowDays=1095` });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { regions: string[]; cells: Array<Record<string, unknown>>; gaps: Array<Record<string, unknown>> };
    expect(body.regions).toEqual(['DE', 'FR']);
    expect(body.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ region: 'FR', seniority: 'c_level', meetings: 1, people: 1 }),
        expect.objectContaining({ region: 'DE', seniority: 'vp', meetings: 1 }),
        expect.objectContaining({ region: 'DE', seniority: 'manager', meetings: 1 }),
      ]),
    );
    expect(body.cells.some((cell) => cell.seniority === 'unknown')).toBe(false); // internal attendees excluded
    expect(body.gaps).toEqual(expect.arrayContaining([{ region: 'DE', seniority: 'c_level' }, { region: 'FR', seniority: 'vp' }]));
    expect(body.gaps).not.toContainEqual({ region: 'FR', seniority: 'c_level' });
    expect((await call({ method: 'GET', url: `/meeting-intel/accounts/${c.b}/coverage` })).statusCode).toBe(404);
  });

  it('challenge rollup merges case variants and skips meetings the caller cannot open', async () => {
    const res = await call({ method: 'GET', url: `/meeting-intel/accounts/${c.root}/challenges?windowDays=1095` });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: Array<{ challenge: string; mentions: number; regions: string[]; meetingIds: string[] }> }).items;
    const erp = items.find((i) => i.challenge.toLowerCase() === 'legacy erp')!;
    expect(erp.mentions).toBe(2);
    expect(erp.regions).toEqual(['DE', 'FR']);
    expect(items.map((i) => i.challenge)).not.toContain('Secret reorg');
  });
});

describe('cross-region flags', () => {
  it('names the account when in scope, redacts it when not, and exposes a watchdog shape', async () => {
    const res = await call({ method: 'GET', url: '/meeting-intel/flags' });
    expect(res.statusCode, res.body).toBe(200);
    const [f] = (res.json() as { items: Array<Record<string, unknown>> }).items;
    expect(f).toMatchObject({ id: flagId, companyName: `${TAG} Acme Germany`, companyRestricted: false, status: 'open' });
    expect(String(f!.reason)).toContain(`${TAG} deTeam`);
    await withScope(adminId, ['FR'], async () => {
      const red = (await call({ method: 'GET', url: '/meeting-intel/flags' })).json() as { items: Array<Record<string, unknown>> };
      expect(red.items[0]).toMatchObject({ companyName: 'Restricted company', companyRestricted: true });
      expect(JSON.stringify(red.items[0])).not.toContain('Acme Germany');
      expect(JSON.stringify(red.items[0])).not.toContain('deTeam');
      const wd = (await call({ method: 'GET', url: '/meeting-intel/flags?format=watchdog' })).json() as { items: Array<Record<string, unknown>> };
      expect(wd.items[0]).toMatchObject({ kind: 'MEETING_CROSS_REGION', externalId: flagId, companyId: c.fr, implication: 'OPPORTUNITY' });
      expect(JSON.stringify(wd.items[0])).not.toContain('Acme Germany');
      expect(JSON.stringify(wd.items)).not.toMatch(/\u2014/);
    });
  });

  it('only the recipient can dismiss', async () => {
    clearRbacDecisionCacheForTest();
    expect((await call({ method: 'POST', url: `/meeting-intel/flags/${flagId}/dismiss`, role: 'sales-manager' })).statusCode).toBe(404);
    expect((await call({ method: 'POST', url: `/meeting-intel/flags/${flagId}/dismiss` })).statusCode).toBe(204);
    expect(((await call({ method: 'GET', url: '/meeting-intel/flags' })).json() as { items: unknown[] }).items).toHaveLength(0);
    expect(((await call({ method: 'GET', url: '/meeting-intel/flags?status=all' })).json() as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe('manual entry and edits', () => {
  let created = '';
  it('creates with seniority classification, dedupes, enqueues flags, refuses foreign accounts', async () => {
    const body = {
      companyId: c.fr,
      title: `${TAG} Workshop`,
      heldAt: '2026-10-15T09:00:00.000Z',
      attendees: [{ name: 'Paul', title: 'Head of Procurement', email: 'paul@acme-fr.example' }],
      challenges: ['Budget freeze'],
    };
    const res = await call({ method: 'POST', url: '/meeting-intel', payload: body });
    expect(res.statusCode, res.body).toBe(201);
    created = (res.json() as { id: string }).id;
    const att = await prisma.meetingIntelAttendee.findFirstOrThrow({ where: { meetingId: created } });
    expect(att).toMatchObject({ seniority: 'vp', region: 'FR', isInternal: false });
    expect(queued).toContainEqual({ kind: 'flags', orgId: orgA.orgId, meetingId: created });
    expect((await call({ method: 'POST', url: '/meeting-intel', payload: { ...body, title: `RE: ${body.title}` } })).statusCode).toBe(409);
    expect((await call({ method: 'POST', url: '/meeting-intel', payload: { ...body, companyId: c.b } })).statusCode).toBe(404);
  });

  it('only the team or author can edit; edits and archive are audited', async () => {
    clearRbacDecisionCacheForTest();
    expect((await call({ method: 'PATCH', url: `/meeting-intel/${m.deOrg}`, role: 'sales-manager', payload: { nextSteps: ['x'] } })).statusCode).toBe(403);
    const ok = await call({ method: 'PATCH', url: `/meeting-intel/${created}`, payload: { visibility: 'org', nextSteps: ['Follow up'] } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await call({ method: 'DELETE', url: `/meeting-intel/${created}` })).statusCode).toBe(204);
    expect((await call({ method: 'GET', url: `/meeting-intel/${created}` })).statusCode).toBe(404);
    const actions = (await prisma.auditLog.findMany({ where: { orgId: orgA.orgId, targetId: created }, select: { action: true }, take: 20 })).map((a) => a.action);
    expect(actions.sort()).toEqual(['meeting_intel.archive', 'meeting_intel.create', 'meeting_intel.update']);
  });
});

describe('sources and Metis consent ingest', () => {
  let token = '';
  it('reports not connected, then connects with summaries only by default', async () => {
    const before = (await call({ method: 'GET', url: '/meeting-intel/sources' })).json() as { items: Array<Record<string, unknown>> };
    expect(before.items.map((i) => [i.source, i.status])).toEqual([
      ['abc', 'not_connected'],
      ['metis', 'not_connected'],
    ]);
    expect((await call({ method: 'POST', url: '/meeting-intel/sources/metis/connect', payload: { shareSummary: false } })).statusCode).toBe(400);
    const res = await call({ method: 'POST', url: '/meeting-intel/sources/metis/connect', payload: { shareSummary: true } });
    expect(res.statusCode, res.body).toBe(200);
    const b = res.json() as { token: string; shareTranscript: boolean };
    token = b.token;
    expect(token.startsWith('pmi_')).toBe(true);
    expect(b.shareTranscript).toBe(false);
    const conn = await prisma.meetingSourceConnection.findFirstOrThrow({ where: { orgId: orgA.orgId, source: 'metis' } });
    expect(conn.tokenHash).not.toBe(token);
    expect(JSON.stringify(conn)).not.toContain(token);
  });

  it('push ingest refuses confidential meetings and drops transcripts without consent', async () => {
    const meeting = (externalId: string, extra: Record<string, unknown> = {}) => ({
      externalId,
      title: `${TAG} metis ${externalId}`,
      heldAt: '2026-10-20T10:00:00.000Z',
      accountName: `${TAG} Acme France`,
      attendees: [],
      ...extra,
    });
    const auth = { authorization: `Bearer ${token}` };
    const res = await call({
      method: 'POST',
      url: '/meeting-intel/ingest/metis',
      headers: auth,
      payload: { meetings: [meeting('ok-1', { transcript: 'raw words' }), meeting('conf-1', { confidential: true })] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, duplicates: 0, refused: [{ externalId: 'conf-1', reason: 'confidential' }] });
    const item = await prisma.meetingIngestItem.findFirstOrThrow({ where: { orgId: orgA.orgId, externalId: 'ok-1' } });
    expect(item.submittedById).toBe(adminId);
    expect(JSON.stringify(item.payload)).not.toContain('raw words');
    expect(queued).toContainEqual({ kind: 'process', orgId: orgA.orgId, itemId: item.id });
    const again = await call({ method: 'POST', url: '/meeting-intel/ingest/metis', headers: auth, payload: { meetings: [meeting('ok-1')] } });
    expect(again.json()).toMatchObject({ accepted: 0, duplicates: 1 });
    expect((await call({ method: 'POST', url: '/meeting-intel/ingest/metis', headers: { authorization: 'Bearer pmi_nope_nope_nope' }, payload: { meetings: [meeting('x')] } })).statusCode).toBe(401);
    expect((await call({ method: 'POST', url: '/meeting-intel/ingest/metis', payload: { meetings: [meeting('x')] } })).statusCode).toBe(401);
    expect(await prisma.auditLog.count({ where: { orgId: orgA.orgId, action: 'meeting_intel.ingest' } })).toBe(2);
  });

  it('revoking kills the token; ABC sync creates the org connection and enqueues', async () => {
    expect((await call({ method: 'DELETE', url: '/meeting-intel/sources/metis' })).statusCode).toBe(204);
    expect(
      (await call({ method: 'POST', url: '/meeting-intel/ingest/metis', headers: { authorization: `Bearer ${token}` }, payload: { meetings: [{ externalId: 'z', title: 'z', heldAt: '2026-10-20T10:00:00.000Z', attendees: [] }] } }))
        .statusCode,
    ).toBe(401);
    const sync = await call({ method: 'POST', url: '/meeting-intel/sources/abc/sync' });
    expect(sync.statusCode, sync.body).toBe(202);
    const { connectionId } = sync.json() as { connectionId: string };
    expect(queued).toContainEqual({ kind: 'sync', orgId: orgA.orgId, connectionId });
    const after = (await call({ method: 'GET', url: '/meeting-intel/sources' })).json() as { items: Array<Record<string, unknown>> };
    expect(after.items.map((i) => [i.source, i.status])).toEqual([
      ['abc', 'connected'],
      ['metis', 'revoked'],
    ]);
  });
});
