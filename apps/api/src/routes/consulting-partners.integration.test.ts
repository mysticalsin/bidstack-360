import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma, savePartnerEvidence, scanInternalPartnerEvidence } from '@bidstack/db';
import { ConsultingPartnersSummary, DEFAULT_CONSULTING_FIRMS, PartnerEvidencePage, RBAC_MATRIX } from '@bidstack/shared';

import { __setConsultingPartnersEnqueueForTest } from '../queues/consulting-partners.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// Slice 15: consulting partners under /api/v1/companies/:id/consulting-partners.
// Public evidence follows the account; internal evidence follows the record.

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;
const queued: string[] = [];
const DAY = 86_400_000;

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  __setConsultingPartnersEnqueueForTest(async (job) => {
    queued.push(job.companyId);
    return `job-${queued.length}`;
  });
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    return;
  }
  const org = await createIsolatedOrg('partners');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setConsultingPartnersEnqueueForTest(null);
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

async function users() {
  const all = await prisma.user.findMany({ where: { orgId: orgId! }, orderBy: { createdAt: 'asc' }, select: { id: true }, take: 2 });
  return { me: all[0]!.id, teammate: all[1]!.id };
}

async function seeded() {
  const now = Date.now();
  const { me, teammate } = await users();
  const c = await prisma.company.create({ data: { orgId: orgId!, name: `Partner Co ${now}`, tier: 'key' } });
  const note = await prisma.note.create({
    data: { orgId: orgId!, accountId: c.id, companyId: c.id, authorUserId: me, title: 'Steering debrief', bodyMd: 'Client said our delivery quality is better than KPMG, but KPMG is cheaper.' },
  });
  const open = await prisma.meetingIntel.create({
    data: { orgId: orgId!, companyId: c.id, title: 'QBR', heldAt: new Date(now - 3 * DAY), visibility: 'org', summary: 'Accenture is the incumbent on the SAP rollout.', dedupeKey: `open-${now}`, createdById: teammate },
  });
  const closed = await prisma.meetingIntel.create({
    data: { orgId: orgId!, companyId: c.id, title: 'Private call', heldAt: new Date(now - 2 * DAY), visibility: 'account_team', summary: 'Client feedback: Deloitte was slow on the cyber programme.', dedupeKey: `closed-${now}`, createdById: teammate },
  });
  const drafts = await scanInternalPartnerEvidence(prisma, { orgId: orgId!, companyId: c.id, firms: DEFAULT_CONSULTING_FIRMS });
  await savePartnerEvidence(prisma, { orgId: orgId!, companyId: c.id, drafts, now: new Date(), replaceInternal: true });
  await prisma.consultingPartnerEvidence.create({
    data: {
      orgId: orgId!, companyId: c.id, firmKey: 'kpmg', firmName: 'KPMG', origin: 'public', source: 'google_news', method: 'keyword_match', key: `pub:${now}`,
      url: 'https://news.example.com/kpmg', title: `${c.name} selects KPMG for finance advisory`, excerpt: `${c.name} selects KPMG for finance advisory.`,
      occurredAt: new Date(now - 30 * DAY), fetchedAt: new Date(), relationship: 'advisory', domains: ['digital'],
    },
  });
  await prisma.consultingPartnerRun.create({ data: { orgId: orgId!, companyId: c.id, status: 'ok', lastFetchedAt: new Date(now - DAY), result: { new: 4, updated: 0, skipped: 0, failed: 0 } } });
  return { c, note, open, closed };
}

const get = (url: string, headers: Record<string, string> = {}) => server.inject({ method: 'GET', url, headers });

describe('consulting partners routes', () => {
  skipIfNoDb('summary scans our records, cites every angle and score, and shows the run', async () => {
    const { c } = await seeded();
    const res = await get(`/api/v1/companies/${c.id}/consulting-partners`);
    expect(res.statusCode).toBe(200);
    const body = ConsultingPartnersSummary.parse(res.json());
    const kpmg = body.partners.find((p) => p.firmKey === 'kpmg')!;
    expect(kpmg).toMatchObject({ publicCount: 1, internalCount: 1, relationships: ['advisory'] });
    expect(kpmg.scorecard.find((d) => d.dimension === 'quality')).toMatchObject({ status: 'scored', us: 100, evidenceCount: 1 });
    expect(kpmg.scorecard.find((d) => d.dimension === 'speed')).toMatchObject({ status: 'no_evidence', us: null, partner: null });
    const ids = new Set(kpmg.timeline.map((t) => t.id));
    for (const a of kpmg.angles) for (const id of a.evidenceIds) expect(ids.has(id)).toBe(true);
    expect(body.run).toMatchObject({ status: 'ok', result: { new: 4 } });
    expect(JSON.stringify(body)).not.toContain('\u2014');
  });

  skipIfNoDb('internal evidence follows the record: private meetings and deleted notes drop out', async () => {
    const { c, note } = await seeded();
    const body = ConsultingPartnersSummary.parse((await get(`/api/v1/companies/${c.id}/consulting-partners`)).json());
    expect(body.partners.map((p) => p.firmKey)).toContain('accenture');
    expect(body.partners.map((p) => p.firmKey)).not.toContain('deloitte');
    const stored = await prisma.consultingPartnerEvidence.count({ where: { orgId: orgId!, companyId: c.id, firmKey: 'deloitte' } });
    expect(stored).toBe(1);
    await prisma.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
    const after = ConsultingPartnersSummary.parse((await get(`/api/v1/companies/${c.id}/consulting-partners`)).json());
    expect(after.partners.find((p) => p.firmKey === 'kpmg')).toMatchObject({ internalCount: 0 });
  });

  skipIfNoDb('evidence pages with a cursor and filters by origin', async () => {
    const { c } = await seeded();
    const first = PartnerEvidencePage.parse((await get(`/api/v1/companies/${c.id}/consulting-partners/kpmg/evidence?limit=1`)).json());
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe('1');
    const second = PartnerEvidencePage.parse((await get(`/api/v1/companies/${c.id}/consulting-partners/kpmg/evidence?limit=1&cursor=1`)).json());
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    const pub = PartnerEvidencePage.parse((await get(`/api/v1/companies/${c.id}/consulting-partners/kpmg/evidence?origin=public`)).json());
    expect(pub.items.every((e) => e.origin === 'public' && e.url)).toBe(true);
    expect((await get(`/api/v1/companies/${c.id}/consulting-partners/KPMG%20LLP/evidence`)).statusCode).toBe(400);
  });

  skipIfNoDb('refresh queues a job with a 202 and records it as queued', async () => {
    const { c } = await seeded();
    const res = await server.inject({ method: 'POST', url: `/api/v1/companies/${c.id}/consulting-partners/refresh` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ queued: true, run: { status: 'queued' } });
    expect(queued.at(-1)).toBe(c.id);
  });

  skipIfNoDb('RBAC: Read-Only reads but cannot refresh; another org gets 404', async () => {
    const { c } = await seeded();
    expect(RBAC_MATRIX['Read-Only']).toContain('account-intel:read');
    expect(RBAC_MATRIX['Read-Only']).not.toContain('account-intel:write');
    const ro = { 'x-bidstack-e2e-role': 'read-only' };
    expect((await get(`/api/v1/companies/${c.id}/consulting-partners`, ro)).statusCode).toBe(200);
    const write = await server.inject({ method: 'POST', url: `/api/v1/companies/${c.id}/consulting-partners/refresh`, headers: ro });
    expect(write.statusCode).toBe(403);
    const other = await prisma.org.create({ data: { clerkOrg: `org_partners_other_${Date.now()}`, name: 'Other' } });
    const foreign = await prisma.company.create({ data: { orgId: other.id, name: 'Foreign Co' } });
    await prisma.consultingPartnerEvidence.create({
      data: { orgId: other.id, companyId: foreign.id, firmKey: 'ey', firmName: 'EY', origin: 'public', source: 'fixture', method: 'fixture', key: 'pub:x', excerpt: 'Foreign Co picks EY.', fetchedAt: new Date() },
    });
    expect((await get(`/api/v1/companies/${foreign.id}/consulting-partners`)).statusCode).toBe(404);
    expect((await get(`/api/v1/companies/${foreign.id}/consulting-partners/ey/evidence`)).statusCode).toBe(404);
    expect((await server.inject({ method: 'POST', url: `/api/v1/companies/${foreign.id}/consulting-partners/refresh` })).statusCode).toBe(404);
    await prisma.org.delete({ where: { id: other.id } }).catch(() => undefined);
  });
});
