// MARS sync with the Power BI source (mocked executeQueries) against the real
// DB: one query per mapped account, per account watermarks in settings,
// unmapped accounts never queried, strict re-check, name-only colleagues
// resolved to users, idempotent replay and the per run query budget.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import { type MarsColumnMap, type MeetingIntelJob, parseMarsSettings } from '@bidstack/shared';

import { processIngestItem, type PipelineDeps } from '../meeting-intel/pipeline.js';

import type { MarsClient } from './client.js';
import { powerBiMarsSource } from './powerbi.js';
import { mockPowerBi, pbiDate } from './powerbi-mock.js';
import { type MarsSyncDeps, runMarsSync } from './sync.js';

const stamp = Date.now();
const NOW = new Date('2026-10-31T15:00:00Z');
const own = `pbi${stamp}.test`;
const MAP: MarsColumnMap = {
  table: 'MARS',
  columns: { account: 'Account', contactName: 'Contact', contactEmail: 'Email', contactTitle: 'Title', company: 'Company', meetingDate: 'Date', internalAttendee: 'Internal', notes: 'Notes', entryId: 'Entry', updatedAt: 'Modified' },
};
const day = (n: number) => pbiDate(new Date(NOW.getTime() - n * 86_400_000));
const r = (entry: string, account: string, d: number, contact: string, email: string, title: string, internal: string) => ({
  Entry: entry, Account: account, Contact: contact, Email: email, Title: title, Company: account, Date: day(d), Modified: day(d - 1), Internal: internal, Notes: null,
});

let orgId = '';
let adminId = '';
let nw = '';
let ct = '';
let connId = '';
const queued: MeetingIntelJob[] = [];
const pipeDeps: PipelineDeps = { adapters: {} as PipelineDeps['adapters'], enqueue: async (j) => void queued.push(j), now: () => NOW };
let table: Array<Record<string, unknown>> = [];
const pbi = mockPowerBi(MAP, () => table);
const source = powerBiMarsSource(
  { tenantId: 'contoso.onmicrosoft.com', clientId: 'id', clientSecret: 'secret', workspaceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', datasetId: 'ffffffff-0000-1111-2222-333333333333', columns: MAP, minIntervalMs: 0 },
  { fetch: pbi.fetch, sleep: async () => undefined, now: () => NOW },
);
const deps = (over: Partial<MarsSyncDeps> = {}): MarsSyncDeps => ({
  client: source, enqueue: async (j) => void queued.push(j), now: () => NOW, enabled: true, pageSize: 100, maxPages: 20, maxQueries: 100, webBaseUrl: null, ...over,
});
async function drain() {
  while (queued.length) {
    const j = queued.shift()!;
    if (j.kind === 'process') await processIngestItem(j, pipeDeps);
  }
}

beforeAll(async () => {
  orgId = (await prisma.org.create({ data: { name: 'MARS Power BI', clerkOrg: `org_pbi_${stamp}` } })).id;
  adminId = (await prisma.user.create({ data: { orgId, clerkUser: `user_pbi_a_${stamp}`, email: `kam.uk@${own}`, name: 'Alex Turner' } })).id;
  await prisma.user.create({ data: { orgId, clerkUser: `user_pbi_s_${stamp}`, email: `sam.lee@${own}`, name: 'Sam Lee' } });
  nw = (await prisma.company.create({ data: { orgId, name: 'Northwind Energy', domain: 'northwind-energy.example', countryCode: 'GB' } })).id;
  ct = (await prisma.company.create({ data: { orgId, name: 'Contoso', countryCode: 'FR' } })).id;
  await prisma.company.create({ data: { orgId, name: 'Fabrikam', countryCode: 'DE' } });
  connId = (await prisma.meetingSourceConnection.create({
    data: { orgId, userId: adminId, source: 'mars', consentedAt: NOW, settings: { accountKeys: { [nw]: ['Northwind Energy', 'NWE-UK'], [ct]: ['Contoso'] } } },
  })).id;
  table = [
    r('E1', 'Northwind Energy', 20, 'Jane Doe', 'jane@northwind-energy.example', 'Chief Financial Officer', `Alex Turner <kam.uk@${own}>; Sam Lee`),
    r('E1', 'Northwind Energy', 20, 'Raj Patel', 'raj@northwind-energy.example', 'Chief Information Officer', `Alex Turner <kam.uk@${own}>; Sam Lee`),
    r('E2', 'nwe-uk', 12, 'Lena Brandt', 'lena@northwind-energy.example', 'Director Infrastructure', `kam.uk@${own}`),
    r('E3', 'Contoso', 9, 'Marc Petit', 'marc@contoso.example', 'VP Sales', `kam.uk@${own}`),
    r('E4', 'Fabrikam', 8, 'Not Mapped', 'x@fabrikam.example', 'CEO', `kam.uk@${own}`),
    r('E5', 'Northwind Energy Services', 7, 'Not Ours', 'y@nes.example', 'CEO', `kam.uk@${own}`),
  ];
});

afterAll(async () => {
  if (orgId) {
    await prisma.enrichmentCreditUsage.deleteMany({ where: { orgId } }).catch(() => undefined);
    await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
  }
});

describe('runMarsSync with Power BI', () => {
  it('queries each mapped account once, stores its meetings and keeps a watermark per account', async () => {
    const res = await runMarsSync({ orgId }, deps());
    expect(res).toMatchObject({ outcome: 'done', source: 'powerbi', accounts: 2, pages: 2, pulled: 3, stored: 3, refused: 0, unmatched: 0, hasMore: false });
    expect(pbi.calls.queries).toHaveLength(2);
    const filters = pbi.calls.queries.map((q) => /IN \{ (.*) \}/.exec(q)![1]).sort();
    expect(filters).toEqual(['"Contoso"', '"Northwind Energy", "NWE-UK"']);
    expect(pbi.calls.queries.join('\n')).not.toContain('Fabrikam');

    const conn = await prisma.meetingSourceConnection.findUniqueOrThrow({ where: { id: connId } });
    const s = parseMarsSettings(conn.settings);
    expect(Object.keys(s.cursors).sort()).toEqual([nw, ct].sort());
    expect(Object.keys(s.accountKeys)).toHaveLength(2); // the cursor write left the key map alone
    expect(conn.itemsReceived).toBe(3);

    await drain();
    const meetings = await prisma.meetingIntel.findMany({ where: { orgId, deletedAt: null }, include: { attendees: true }, orderBy: { heldAt: 'asc' }, take: 20 });
    expect(meetings.map((m) => m.companyId)).toEqual([nw, nw, ct]);
    const first = meetings[0]!;
    const sam = first.attendees.find((a) => a.name === 'Sam Lee');
    expect(sam).toMatchObject({ email: `sam.lee@${own}`, isInternal: true });
    expect(first.attendees.filter((a) => !a.isInternal).map((a) => a.name).sort()).toEqual(['Jane Doe', 'Raj Patel']);
    expect(JSON.stringify(meetings)).not.toMatch(/Not Ours|Not Mapped/);
  });

  it('replays as a no-op and asks only for later rows', async () => {
    const before = pbi.calls.queries.length;
    const res = await runMarsSync({ orgId }, deps());
    expect(res).toMatchObject({ pulled: 0, stored: 0 });
    for (const q of pbi.calls.queries.slice(before)) expect(q).toContain('> __since');
  });

  it('refuses rows that do not belong to the queried account', async () => {
    const liar: MarsClient = {
      configured: true,
      kind: 'powerbi',
      scope: 'account',
      listEntries: async ({ cursor }) => ({
        items: [{
          id: 'mt-X', version: 2, updatedAt: NOW.toISOString(), weekOf: '2026-10-26', meetingDate: NOW.toISOString(),
          loggedBy: { email: `kam.uk@${own}`, name: 'Alex Turner' }, client: { name: 'Northwind Energy Services', marsAccountId: 'Northwind Energy Services' },
          contacts: [{ fullName: 'Not Ours' }],
        }],
        nextCursor: cursor,
        hasMore: false,
      }),
    };
    const res = await runMarsSync({ orgId }, deps({ client: liar }));
    expect(res).toMatchObject({ pulled: 2, stored: 0, refused: 2 });
  });

  it('stops at the query budget and continues in a follow-up job', async () => {
    await prisma.meetingSourceConnection.update({ where: { id: connId }, data: { settings: { accountKeys: { [nw]: ['Northwind Energy', 'NWE-UK'], [ct]: ['Contoso'] } } } });
    queued.length = 0;
    const res = await runMarsSync({ orgId }, deps({ maxQueries: 1 }));
    expect(res).toMatchObject({ pages: 1, hasMore: true });
    expect(queued.some((j) => j.kind === 'mars-sync')).toBe(true);
  });

  it('queries nothing when no account is mapped', async () => {
    await prisma.meetingSourceConnection.update({ where: { id: connId }, data: { settings: {} } });
    const before = pbi.calls.queries.length;
    const res = await runMarsSync({ orgId }, deps());
    expect(res).toMatchObject({ outcome: 'done', accounts: 0, pages: 0 });
    expect(pbi.calls.queries.length).toBe(before);
  });
});
