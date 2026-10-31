import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { MeetingIntelJob, NormalizedMeeting } from '@bidstack/shared';

import { type AdapterRegistry, defaultAdapters, type PullContext } from './adapters.js';
import { processIngestItem, type PipelineDeps, storeIngestItems, syncConnection } from './pipeline.js';

const stamp = Date.now();
const HELD = '2026-10-20T14:00:00.000Z';
let orgA = '';
let orgB = '';
const u: Record<string, string> = {};
const c: Record<string, string> = {};
let metisConn = '';
let abcConn = '';
let marieId = '';

const queued: MeetingIntelJob[] = [];
const pulls: PullContext[] = [];
let metisRows: NormalizedMeeting[] = [];
let abcRows: NormalizedMeeting[] = [];
const adapters: AdapterRegistry = {
  metis: { source: 'metis', scope: 'user', pull: async (ctx) => (pulls.push(ctx), metisRows) },
  abc: { source: 'abc', scope: 'org', pull: async (ctx) => (pulls.push(ctx), abcRows) },
};
const deps: PipelineDeps = { adapters, enqueue: async (j) => void queued.push(j), now: () => new Date() };

const meeting = (over: Partial<NormalizedMeeting> = {}): NormalizedMeeting => ({
  externalId: `m-${Math.random().toString(36).slice(2)}`,
  title: 'QBR Acme France',
  heldAt: HELD,
  accountName: 'Acme France',
  attendees: [
    { name: 'Marie Curie', email: `marie.${stamp}@acme-fr.example`, title: 'Chief Financial Officer' },
    { name: 'Paul Dir', email: `paul.${stamp}@acme-fr.example`, title: 'Director of IT' },
    { name: 'Fran KAM', email: `fr.${stamp}@polo.test` },
  ],
  summary: 'Budget review',
  challenges: ['Legacy ERP migration'],
  similarProjects: [],
  opportunities: ['Data platform'],
  nextSteps: ['Send proposal'],
  ...over,
});

async function drain() {
  const results = [];
  while (queued.length) {
    const j = queued.shift()!;
    results.push(j.kind === 'process' ? await processIngestItem(j, deps) : await syncConnection(j, deps));
  }
  return results;
}

beforeAll(async () => {
  orgA = (await prisma.org.create({ data: { name: 'MI A', clerkOrg: `org_mi_a_${stamp}` } })).id;
  orgB = (await prisma.org.create({ data: { name: 'MI B', clerkOrg: `org_mi_b_${stamp}` } })).id;
  const mkU = async (k: string, orgId = orgA) =>
    (u[k] = (await prisma.user.create({ data: { orgId, clerkUser: `user_mi_${k}_${stamp}`, email: `${k}.${stamp}@polo.test`, name: k } })).id);
  for (const k of ['fr', 'de', 'uk', 'sales']) await mkU(k);
  await mkU('other', orgB);
  const mkC = async (k: string, data: Record<string, unknown>, orgId = orgA) =>
    (c[k] = (await prisma.company.create({ data: { orgId, ...data } as never })).id);
  await mkC('root', { name: 'Acme Group', tier: 'key' });
  await mkC('fr', { name: 'Acme France', parentId: c.root, countryCode: 'FR', keyAccountOwnerId: u.fr, domain: 'acme-fr.example' });
  await mkC('de', { name: 'Acme Germany', parentId: c.root, countryCode: 'DE', keyAccountOwnerId: u.de });
  await mkC('uk', { name: 'Acme UK', parentId: c.root, countryCode: 'GB' });
  await mkC('bfr', { name: 'Acme France', countryCode: 'FR' }, orgB);
  await prisma.opportunity.create({
    data: { orgId: orgA, code: `MI-${stamp}`, customer: 'Acme UK', name: 'UK deal', stage: 's2_sent', ownerId: u.uk, companyId: c.uk },
  });
  const g = await prisma.userGroup.create({ data: { orgId: orgA, name: `UK only ${stamp}`, scopeCountries: ['GB'] } });
  await prisma.userGroupMember.create({ data: { orgId: orgA, groupId: g.id, userId: u.uk! } });
  marieId = (
    await prisma.contact.create({
      data: { orgId: orgA, customer: 'Acme France', name: 'Marie Curie', email: `marie.${stamp}@acme-fr.example`, companyId: c.fr },
    })
  ).id;
  metisConn = (await prisma.meetingSourceConnection.create({ data: { orgId: orgA, userId: u.sales!, source: 'metis', consentedAt: new Date() } })).id;
  abcConn = (await prisma.meetingSourceConnection.create({ data: { orgId: orgA, userId: u.fr!, source: 'abc' } })).id;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) if (id) await prisma.org.delete({ where: { id } }).catch(() => undefined);
});

describe('meeting intel pipeline', () => {
  it('sync applies consent: summaries only, confidential refused, no transcript requested', async () => {
    metisRows = [meeting({ transcript: 'raw words' }), meeting({ externalId: 'conf-1', confidential: true })];
    const res = await syncConnection({ orgId: orgA, connectionId: metisConn }, deps);
    expect(res).toMatchObject({ pulled: 2, stored: 1, refused: 1, outcome: 'done' });
    expect(pulls.at(-1)).toMatchObject({ userId: u.sales, includeTranscript: false, since: null });
    const items = await prisma.meetingIngestItem.findMany({ where: { orgId: orgA } });
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items[0]!.payload)).not.toContain('raw words');
    const conn = await prisma.meetingSourceConnection.findUniqueOrThrow({ where: { id: metisConn } });
    expect(conn.lastSyncAt).not.toBeNull();
    expect(conn.itemsReceived).toBe(1);
    // A re-pull of the same meeting is a no-op.
    expect((await syncConnection({ orgId: orgA, connectionId: metisConn }, deps)).stored).toBe(0);
  });

  it('process matches account and contacts, classifies seniority and flags other regions', async () => {
    const [res] = await drain();
    expect(res).toMatchObject({ outcome: 'created', flags: 2 });
    const mi = await prisma.meetingIntel.findFirstOrThrow({ where: { orgId: orgA }, include: { attendees: true, sources: true } });
    expect(mi.companyId).toBe(c.fr);
    expect(mi.transcriptText).toBeNull();
    expect(mi.visibility).toBe('account_team');
    const marie = mi.attendees.find((a) => a.name === 'Marie Curie')!;
    expect(marie).toMatchObject({ contactId: marieId, seniority: 'c_level', region: 'FR', isInternal: false });
    expect(mi.attendees.find((a) => a.name === 'Paul Dir')!.seniority).toBe('director');
    expect(mi.attendees.find((a) => a.name === 'Fran KAM')).toMatchObject({ userId: u.fr, isInternal: true });
    expect(mi.sources.map((s) => s.source)).toEqual(['metis']);

    const flags = await prisma.meetingCrossRegionFlag.findMany({ where: { orgId: orgA } });
    expect(flags.map((f) => f.recipientUserId).sort()).toEqual([u.de, u.uk].sort());
    const ukFlag = flags.find((f) => f.recipientUserId === u.uk)!;
    expect(ukFlag.reason).not.toContain('Acme France'); // UK user cannot see the FR account
    expect(ukFlag.reason).not.toContain('QBR');
    expect(ukFlag.talkingPoints.join(' ')).not.toMatch(/\u2014/);
    const deFlag = flags.find((f) => f.recipientUserId === u.de)!;
    expect(deFlag.reason).toContain('Acme France');
    const notes = await prisma.notification.findMany({ where: { orgId: orgA, entityType: 'meeting_intel_flag' } });
    expect(notes.map((n) => n.userId).sort()).toEqual([u.de, u.uk].sort());
    const item = await prisma.meetingIngestItem.findFirstOrThrow({ where: { orgId: orgA, status: 'processed' } });
    expect(item.meetingIntelId).toBe(mi.id);
  });

  it('dedupes the same meeting from ABC into one record with two source links, no new flags', async () => {
    abcRows = [meeting({ externalId: 'abc-1', title: 'RE: QBR  Acme France', url: 'https://abc.example/m/1', nextSteps: ['Book workshop'] })];
    await syncConnection({ orgId: orgA, connectionId: abcConn }, deps);
    const [res] = await drain();
    expect(res).toMatchObject({ outcome: 'merged', flags: 0 });
    const all = await prisma.meetingIntel.findMany({ where: { orgId: orgA }, include: { sources: true, attendees: true } });
    expect(all).toHaveLength(1);
    expect(all[0]!.sources.map((s) => s.source).sort()).toEqual(['abc', 'metis']);
    expect(all[0]!.sources.find((s) => s.source === 'abc')!.url).toBe('https://abc.example/m/1');
    expect(all[0]!.nextSteps).toEqual(['Send proposal', 'Book workshop']);
    expect(all[0]!.attendees).toHaveLength(3);
    expect(await prisma.notification.count({ where: { orgId: orgA, entityType: 'meeting_intel_flag' } })).toBe(2);
  });

  it('dedupes by identical external attendees on the same day even with a different title', async () => {
    await storeIngestItems(orgA, { source: 'manual', connectionId: null, submittedById: u.fr!, shareSummary: true, shareTranscript: false }, [
      meeting({ externalId: 'man-1', title: 'Finance sync' }),
    ], deps);
    const [res] = await drain();
    expect(res).toMatchObject({ outcome: 'merged' });
    expect(await prisma.meetingIntel.count({ where: { orgId: orgA } })).toBe(1);
  });

  it('keeps a transcript only when the user consented to share it', async () => {
    await prisma.meetingSourceConnection.update({ where: { id: metisConn }, data: { shareTranscript: true } });
    metisRows = [meeting({ externalId: 'tx-1', title: 'Steering', heldAt: '2026-10-22T10:00:00.000Z', transcript: 'consented words', attendees: [] })];
    await syncConnection({ orgId: orgA, connectionId: metisConn }, deps);
    expect(pulls.at(-1)!.includeTranscript).toBe(true);
    const [res] = await drain();
    const mi = await prisma.meetingIntel.findUniqueOrThrow({ where: { id: (res as { meetingId: string }).meetingId } });
    expect(mi.transcriptText).toBe('consented words');
    const item = await prisma.meetingIngestItem.findFirstOrThrow({ where: { orgId: orgA, externalId: 'tx-1' } });
    expect(JSON.stringify(item.payload)).not.toContain('consented words');
  });

  it('unmatched meetings are not kept, and another org account never matches', async () => {
    await storeIngestItems(orgA, { source: 'manual', connectionId: null, submittedById: u.fr!, shareSummary: true, shareTranscript: false }, [
      meeting({ externalId: 'un-1', accountName: 'Nowhere Ltd', attendees: [], summary: 'secret plans' }),
      meeting({ externalId: 'x-org', accountName: undefined, companyId: c.bfr, attendees: [] }),
    ], deps);
    const res = await drain();
    expect(res.map((r) => (r as { outcome: string }).outcome)).toEqual(['unmatched', 'unmatched']);
    const item = await prisma.meetingIngestItem.findFirstOrThrow({ where: { orgId: orgA, externalId: 'un-1' } });
    expect(JSON.stringify(item.payload)).not.toContain('secret plans');
    expect(await prisma.meetingIntel.count({ where: { orgId: orgB } })).toBe(0);
  });

  it('a source without a configured API records not_configured, and other orgs are untouched', async () => {
    const res = await syncConnection({ orgId: orgA, connectionId: abcConn }, { ...deps, adapters: defaultAdapters });
    expect(res.outcome).toBe('not_configured');
    expect((await prisma.meetingSourceConnection.findUniqueOrThrow({ where: { id: abcConn } })).lastError).toBe('not_configured');
    expect((await syncConnection({ orgId: orgB, connectionId: metisConn }, deps)).outcome).toBe('skipped');
    expect(await processIngestItem({ orgId: orgB, itemId: (await prisma.meetingIngestItem.findFirstOrThrow({ where: { orgId: orgA } })).id }, deps)).toEqual({ outcome: 'skipped' });
  });
});
