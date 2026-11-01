// MARS sync against the real DB: flag off, no connection, a full fake run
// (matched, parent, unmatched, confidential), idempotent replay, cursor
// resume, edits, tombstones, and the org chart seed picking MARS attendees.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { MarsEntry, MeetingIntelJob } from '@bidstack/shared';

import { processIngestItem, type PipelineDeps } from '../meeting-intel/pipeline.js';
import { runOrgChartSeed } from '../org-chart/seed.js';

import { fakeMarsEntries, mockMarsClient } from './mock.js';
import { type MarsSyncDeps, runMarsSync } from './sync.js';

const stamp = Date.now();
const NOW = new Date('2026-10-31T15:00:00Z');
const own = `mars${stamp}.test`;
let orgId = '';
let nw = '';
let nwFr = '';
let entries: unknown[] = [];
let adminId = '';
const queued: MeetingIntelJob[] = [];
const pipeDeps: PipelineDeps = { adapters: {} as PipelineDeps['adapters'], enqueue: async (j) => void queued.push(j), now: () => NOW };

const client = mockMarsClient(() => entries);
const deps = (over: Partial<MarsSyncDeps> = {}): MarsSyncDeps => ({
  client,
  enqueue: async (j) => void queued.push(j),
  now: () => NOW,
  enabled: true,
  pageSize: 3,
  maxPages: 20,
  maxQueries: 100,
  webBaseUrl: 'https://mars.example',
  ...over,
});

async function drain() {
  while (queued.length) {
    const j = queued.shift()!;
    if (j.kind === 'process') await processIngestItem(j, pipeDeps);
  }
}
const meetings = () =>
  prisma.meetingIntel.findMany({
    where: { orgId, deletedAt: null },
    include: { sources: true, attendees: true },
    orderBy: { heldAt: 'asc' },
    take: 50,
  });

beforeAll(async () => {
  orgId = (await prisma.org.create({ data: { name: 'MARS sync', clerkOrg: `org_mars_${stamp}` } })).id;
  for (const k of ['kam.uk', 'kam.fr', 'architect']) {
    const usr = await prisma.user.create({ data: { orgId, clerkUser: `user_mars_${k}_${stamp}`, email: `${k}@${own}`, name: k } });
    if (!adminId) adminId = usr.id;
  }
  nw = (await prisma.company.create({ data: { orgId, name: 'Northwind Energy', domain: 'northwind-energy.example', countryCode: 'GB' } })).id;
  nwFr = (await prisma.company.create({ data: { orgId, name: 'Northwind Services', parentId: nw, countryCode: 'FR' } })).id;
  entries = fakeMarsEntries(NOW, { ownDomain: own });
});

afterAll(async () => {
  if (orgId) {
    await prisma.enrichmentCreditUsage.deleteMany({ where: { orgId } }).catch(() => undefined);
    await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
  }
});

describe('runMarsSync', () => {
  it('does nothing when the flag is off or no connection exists', async () => {
    expect((await runMarsSync({ orgId }, deps({ enabled: false }))).outcome).toBe('disabled');
    expect((await runMarsSync({ orgId }, deps())).outcome).toBe('no_connection');
    expect(client.calls).toBe(0);
  });

  it('records not_configured without calling MARS', async () => {
    const conn = await prisma.meetingSourceConnection.create({ data: { orgId, userId: adminId, source: 'mars', consentedAt: NOW } });
    const res = await runMarsSync({ orgId }, deps({ client: { configured: false, listEntries: async () => { throw new Error('no'); } } }));
    expect(res.outcome).toBe('not_configured');
    expect((await prisma.meetingSourceConnection.findUniqueOrThrow({ where: { id: conn.id } })).lastError).toBe('not_configured');
  });

  it('pulls every page, maps matched entries and keeps the rest for an admin', async () => {
    const res = await runMarsSync({ orgId, reason: 'manual' }, deps());
    expect(res).toMatchObject({ outcome: 'done', pages: 3, pulled: 7, stored: 5, refused: 1, unmatched: 1, hasMore: false });
    await drain();

    const ms = await meetings();
    expect(ms).toHaveLength(5);
    expect(ms.every((m) => m.sources.every((s) => s.source === 'mars'))).toBe(true);
    const fr = ms.find((m) => m.title === 'Finance close automation');
    expect(fr?.companyId).toBe(nw); // parent match: Polo has no French legal entity by that name
    expect(ms.find((m) => m.title.includes('confidential'))).toBeUndefined();

    const sofia = ms.flatMap((m) => m.attendees).find((a) => a.name === 'Sofia Ricci');
    expect(sofia).toMatchObject({ isInternal: false, seniority: 'director' });
    expect(ms.flatMap((m) => m.attendees).some((a) => a.isInternal && a.email === `kam.uk@${own}`)).toBe(true);

    const unmatched = await prisma.meetingIngestItem.findMany({ where: { orgId, source: 'mars', status: 'unmatched' } });
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.payload).toMatchObject({ accountName: 'Contoso Logistics' });
    expect(JSON.stringify(unmatched[0]!.payload)).not.toContain('jan@');

    const conn = await prisma.meetingSourceConnection.findFirstOrThrow({ where: { orgId, source: 'mars' } });
    expect(conn).toMatchObject({ syncCursor: 'c7', lastError: null });
    expect(conn.lastSyncAt?.toISOString()).toBe(NOW.toISOString());
    expect(await prisma.auditLog.count({ where: { orgId, action: 'meeting_intel.source.sync' } })).toBe(1);
  });

  it('is idempotent: a replay from the start stores nothing new', async () => {
    await prisma.meetingSourceConnection.updateMany({ where: { orgId, source: 'mars' }, data: { syncCursor: null } });
    const res = await runMarsSync({ orgId }, deps());
    expect(res.stored).toBe(0);
    await drain();
    expect(await meetings()).toHaveLength(5);
  });

  it('resumes from the saved cursor and re-enqueues itself when pages remain', async () => {
    const before = client.calls;
    const res = await runMarsSync({ orgId }, deps({ maxPages: 1 }));
    expect(res).toMatchObject({ pages: 1, pulled: 0, hasMore: false });
    expect(client.calls - before).toBe(1);

    await prisma.meetingSourceConnection.updateMany({ where: { orgId, source: 'mars' }, data: { syncCursor: 'c0' } });
    const partial = await runMarsSync({ orgId }, deps({ maxPages: 1 }));
    expect(partial.hasMore).toBe(true);
    expect(queued.some((j) => j.kind === 'mars-sync' && j.orgId === orgId)).toBe(true);
    queued.length = 0;
    await prisma.meetingSourceConnection.updateMany({ where: { orgId, source: 'mars' }, data: { syncCursor: 'c7' } });
  });

  it('applies an edit: a moved entry replaces its older MARS-only meeting', async () => {
    const all = entries as MarsEntry[];
    const v1 = all.find((e) => e.id === 'mars-1002')!;
    entries = [...all, { ...v1, version: 2, topic: 'Data platform discovery (rescheduled)', meetingDate: new Date(NOW.getTime() - 20 * 86_400_000).toISOString(), updatedAt: NOW.toISOString() }];
    const res = await runMarsSync({ orgId }, deps());
    expect(res).toMatchObject({ stored: 1, superseded: 1 });
    await drain();
    const titles = (await meetings()).map((m) => m.title);
    expect(titles).toContain('Data platform discovery (rescheduled)');
    expect(titles).not.toContain('Data platform discovery');
  });

  it('archives MARS-only meetings on a tombstone', async () => {
    const all = entries as MarsEntry[];
    const e = all.find((x) => x.id === 'mars-1003')!;
    entries = [...all, { ...e, version: 2, deleted: true, updatedAt: NOW.toISOString() }];
    const res = await runMarsSync({ orgId }, deps());
    expect(res.tombstoned).toBe(1);
    expect((await meetings()).map((m) => m.title)).not.toContain('Cloud landing zone');
  });

  it('feeds the org chart auto-fill with MARS attendees', async () => {
    const res = await runOrgChartSeed(
      { kind: 'orgchart_seed', orgId, companyId: nw, requestedById: null, includeApollo: false, includeMeetingAttendees: true },
      { providers: [], config: { ttlDays: 7, monthlyBudget: { apollo: 0, seamless: 0 }, maxJobPages: 0 }, now: () => NOW },
    );
    expect(res).toBeTruthy();
    const nodes = await prisma.orgChartNode.findMany({ where: { orgId, chart: { companyId: nw }, deletedAt: null }, take: 100 });
    const mars = nodes.filter((n) => n.source === 'mars');
    expect(mars.map((n) => n.name)).toEqual(expect.arrayContaining(['Helen Marsh', 'Omar Haddad', 'Priya Natarajan']));
    expect(nodes.some((n) => n.name === 'Jan de Vries')).toBe(false);
    void nwFr;
  });
});
