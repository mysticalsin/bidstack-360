// Contract test for the account watchdog scan against the real database.
// Skips when Postgres is unreachable. Throwaway org fixtures, cleaned in afterAll.
// No network: every source call goes through an injected fetch stub.
import { prisma } from '@bidstack/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWatchdogScan, syncEnrichmentSignals } from './account-watchdog.js';

let dbReachable = false;
let orgId: string | null = null;
let otherOrgId: string | null = null;
let kamId = '';
let oppOwnerId = '';
let companyId = '';
let subjectId = '';
let unconfiguredSubjectId = '';
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const CH_BODY = {
  items: [
    { transaction_id: `INS-${stamp}`, type: 'LIQ02', category: 'insolvency', date: '2026-10-20', description: 'liquidation-voluntary' },
    { transaction_id: `AA-${stamp}`, type: 'AA', category: 'accounts', date: '2026-09-30', description: 'accounts-with-accounts-type-full' },
    { transaction_id: `CS-${stamp}`, type: 'CS01', category: 'confirmation-statement', date: '2026-09-01' },
  ],
};
const calls: string[] = [];
const fetchStub = (async (url: string) => {
  calls.push(url);
  return { ok: true, status: 200, json: async () => CH_BODY };
}) as never;
const env = { COMPANIES_HOUSE_API_KEY: 'test-only-key', WATCHDOG_MIN_ALERT_SEVERITY: '3' } as NodeJS.ProcessEnv;
const noSleep = async () => undefined;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.accountWatchSubject.count({ take: 1 });
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.create({ data: { name: 'Watchdog Test Org', clerkOrg: `org_wd_${stamp}` } });
  orgId = org.id;
  const other = await prisma.org.create({ data: { name: 'Watchdog Other Org', clerkOrg: `org_wd_other_${stamp}` } });
  otherOrgId = other.id;
  const mk = (tag: string, o: string) =>
    prisma.user.create({ data: { orgId: o, clerkUser: `u_wd_${tag}_${stamp}`, email: `wd-${tag}-${stamp}@watchdog.test`, name: tag, role: 'member' } });
  kamId = (await mk('kam', orgId)).id;
  oppOwnerId = (await mk('opp', orgId)).id;
  const closedOwner = (await mk('closed', orgId)).id;
  const company = await prisma.company.create({ data: { orgId, name: 'Acme Watch Ltd', keyAccountOwnerId: kamId } });
  companyId = company.id;
  await prisma.opportunity.createMany({
    data: [
      { orgId, code: `WD-1-${stamp}`, customer: 'Acme', companyId, name: 'Open deal', stage: 's2_sent', ownerId: oppOwnerId },
      { orgId, code: `WD-2-${stamp}`, customer: 'Acme', companyId, name: 'Old deal', stage: 'closed_lost', ownerId: closedOwner },
    ],
  });
  subjectId = (await prisma.accountWatchSubject.create({ data: { orgId, companyId, companiesHouseNumber: '123456', enabled: true, identifiersConfirmedAt: new Date() } })).id;
  const bare = await prisma.company.create({ data: { orgId, name: 'No Ids Ltd' } });
  unconfiguredSubjectId = (await prisma.accountWatchSubject.create({ data: { orgId, companyId: bare.id, enabled: true, identifiersConfirmedAt: new Date() } })).id;
  // Unconfirmed identifiers: never polled (could be the wrong legal entity).
  const unconfirmed = await prisma.company.create({ data: { orgId, name: 'Unconfirmed Ltd' } });
  await prisma.accountWatchSubject.create({ data: { orgId, companyId: unconfirmed.id, companiesHouseNumber: '777777', enabled: true } });
  // A subject in another org must not be touched by an org-scoped scan.
  const otherCo = await prisma.company.create({ data: { orgId: otherOrgId, name: 'Other Org Co' } });
  await prisma.accountWatchSubject.create({ data: { orgId: otherOrgId, companyId: otherCo.id, companiesHouseNumber: '654321', enabled: true, identifiersConfirmedAt: new Date() } });
});

afterAll(async () => {
  for (const id of [orgId, otherOrgId]) {
    if (!id) continue;
    await prisma.notification.deleteMany({ where: { orgId: id } });
    await prisma.accountWatchEvent.deleteMany({ where: { orgId: id } });
    await prisma.accountWatchSubject.deleteMany({ where: { orgId: id } });
    await prisma.opportunity.deleteMany({ where: { orgId: id } });
    await prisma.company.deleteMany({ where: { orgId: id } });
    await prisma.user.deleteMany({ where: { orgId: id } });
    await prisma.org.deleteMany({ where: { id } });
  }
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!dbReachable) ctx.skip();
    await fn();
  });

describe('runWatchdogScan (DB contract)', () => {
  t('stores material filings, alerts KAM + open-deal owners once, and records honest status', async () => {
    const now = new Date('2026-10-31T12:00:00Z');
    const first = await runWatchdogScan({ orgId: orgId!, env, fetchImpl: fetchStub, now, sleep: noSleep });
    expect(first).toEqual({ subjects: 2, inserted: 2, alerted: 1, errored: 1, enrichment: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/company/00123456/filing-history');

    const events = await prisma.accountWatchEvent.findMany({ where: { orgId: orgId! }, orderBy: { occurredAt: 'desc' } });
    expect(events.map((e) => [e.kind, e.implication, e.severity])).toEqual([
      ['INSOLVENCY', 'RISK', 5],
      ['ANNUAL_REPORT', 'NEUTRAL', 2],
    ]);
    const notes = await prisma.notification.findMany({ where: { orgId: orgId! } });
    expect(notes.map((n) => n.userId).sort()).toEqual([kamId, oppOwnerId].sort());
    for (const n of notes) {
      expect(n).toMatchObject({ type: 'system', entityType: 'company', entityId: companyId, url: `/accounts/${companyId}` });
      expect(n.title).toMatch(/^Risk: Acme Watch Ltd/);
    }
    const subj = await prisma.accountWatchSubject.findUniqueOrThrow({ where: { id: subjectId } });
    expect(subj.lastCheckedAt?.toISOString()).toBe(now.toISOString());
    expect(subj.lastError).toBeNull();
    const bare = await prisma.accountWatchSubject.findUniqueOrThrow({ where: { id: unconfiguredSubjectId } });
    expect(bare.lastError).toBe('No public-filing identifier on this account');
    // Other org untouched.
    expect(await prisma.accountWatchEvent.count({ where: { orgId: otherOrgId! } })).toBe(0);
  });

  t('a re-run inside the recheck window is a no-op; after it, nothing is duplicated or re-alerted', async () => {
    const soon = await runWatchdogScan({ orgId: orgId!, env, fetchImpl: fetchStub, now: new Date('2026-10-31T13:00:00Z'), sleep: noSleep });
    expect(soon.subjects).toBe(0);
    const later = await runWatchdogScan({ orgId: orgId!, env, fetchImpl: fetchStub, now: new Date('2026-10-31T20:00:00Z'), sleep: noSleep });
    expect(later).toMatchObject({ subjects: 2, inserted: 0, alerted: 0 });
    expect(await prisma.accountWatchEvent.count({ where: { orgId: orgId! } })).toBe(2);
    expect(await prisma.notification.count({ where: { orgId: orgId! } })).toBe(2);
  });

  t('without COMPANIES_HOUSE_API_KEY it makes no call and says so in lastError', async () => {
    const before = calls.length;
    await runWatchdogScan({ orgId: orgId!, env: {}, fetchImpl: fetchStub, now: new Date('2026-11-01T06:00:00Z'), sleep: noSleep });
    expect(calls.length).toBe(before);
    const subj = await prisma.accountWatchSubject.findUniqueOrThrow({ where: { id: subjectId } });
    expect(subj.lastError).toBe('Companies House not configured (COMPANIES_HOUSE_API_KEY)');
  });
});

describe('syncEnrichmentSignals (DB contract)', () => {
  t('inserts medium+ potential projects once per project, keeps dismissals, sends no alerts, stays in its org', async () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const co = await prisma.company.create({ data: { orgId: orgId!, name: 'Enriched Ltd' } });
    const ev = { postingId: 'p1', title: 'Cloud Architect', url: 'https://jobs.example/9', region: 'EMEA', seniority: 'principal', postedAt: '2026-10-25T00:00:00.000Z', source: 'apollo' };
    const proj = (id: string, confidence: string) => ({ id, kind: id.split(':')[0], name: `P ${id}`, rationale: 'Hiring.', confidence, region: 'EMEA', postingCount: 11, seniorCount: 2, skills: [], evidence: [ev], method: 'rules' });
    await prisma.companyFirmographics.create({
      data: { orgId: orgId!, companyId: co.id, status: 'ok', fetchedAt: new Date('2026-10-31T12:00:00Z'), projects: [proj('cloud_migration:EMEA', 'high'), proj('crm:EMEA', 'medium'), proj('erp:EMEA', 'low')] },
    });
    // Too old for the lookback window: ignored.
    const old = await prisma.company.create({ data: { orgId: orgId!, name: 'Old Enriched Ltd' } });
    await prisma.companyFirmographics.create({ data: { orgId: orgId!, companyId: old.id, status: 'ok', fetchedAt: new Date('2026-09-01T00:00:00Z'), projects: [proj('crm:AMER', 'high')] } });
    const notesBefore = await prisma.notification.count({ where: { orgId: orgId! } });

    expect(await syncEnrichmentSignals(prisma, { now, orgId: orgId! })).toBe(2);
    const rows = await prisma.accountWatchEvent.findMany({ where: { orgId: orgId!, source: 'enrichment' }, orderBy: { severity: 'desc' } });
    expect(rows.map((r) => [r.companyId, r.externalId, r.implication, r.severity, r.confirmed])).toEqual([
      [co.id, 'cloud_migration:EMEA', 'OPPORTUNITY', 2, false],
      [co.id, 'crm:EMEA', 'OPPORTUNITY', 1, false],
    ]);
    await prisma.accountWatchEvent.update({ where: { id: rows[0]!.id }, data: { status: 'DISMISSED' } });
    expect(await syncEnrichmentSignals(prisma, { now, orgId: orgId! })).toBe(0);
    expect((await prisma.accountWatchEvent.findUnique({ where: { id: rows[0]!.id } }))!.status).toBe('DISMISSED');
    expect(await prisma.notification.count({ where: { orgId: orgId! } })).toBe(notesBefore);
    expect(await prisma.accountWatchEvent.count({ where: { orgId: otherOrgId!, source: 'enrichment' } })).toBe(0);
  });
});
