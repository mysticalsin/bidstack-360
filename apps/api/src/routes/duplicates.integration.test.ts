// Integration tests for /api/v1/duplicates/*.
//
// The three merge-safety contracts under test:
// 1. Clustering is org-scoped — a same-name company in ANOTHER org must never
//    appear in this org's clusters (multi-tenancy is non-negotiable).
// 2. Merge re-points child FKs to the survivor, soft-deletes the loser, and a
//    RETRY of the same merge converges (200, same final state) instead of
//    erroring — client retries after a network blip must be safe.
// 3. Merging against a record in another org 404s (FK-graft guard).

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let foreignOrgId: string | null = null;
let seedUserId: string | null = null;
let restoreAuth: (() => void) | null = null;
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('duplicates');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

  // Bare second tenant — just enough rows to prove cross-org invisibility.
  const foreign = await prisma.org.create({
    data: { clerkOrg: `org_dupforeign_${suffix}`, name: `Dup Foreign ${suffix}` },
  });
  foreignOrgId = foreign.id;

  const user = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  seedUserId = user?.id ?? null;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  restoreAuth?.();
  if (server) await server.close();
  // Org cascade-delete reclaims every row created below.
  if (foreignOrgId) await dropIsolatedOrg(foreignOrgId);
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId && !!seedUserId);

function createCompany(inOrgId: string, name: string, extra?: { domain?: string; website?: string }) {
  return prisma.company.create({
    data: {
      orgId: inOrgId,
      name,
      domain: extra?.domain ?? null,
      website: extra?.website ?? null,
      source: 'manual',
    },
    select: { id: true },
  });
}

describe('duplicates routes', () => {
  skipIfNoDb('clusters same-name companies in-org; cross-org twin never appears', async () => {
    const name = `Meridian Grid Consortium ${suffix}`;
    const [a, b] = await Promise.all([
      createCompany(orgId!, name),
      createCompany(orgId!, `${name.toUpperCase()}!`),
    ]);
    const foreign = await createCompany(foreignOrgId!, name);

    const res = await server.inject({ method: 'GET', url: '/api/v1/duplicates/companies' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      clusters: Array<{ reasons: string[]; companies: Array<{ id: string }> }>;
    };
    const allIds = body.clusters.flatMap((c) => c.companies.map((r) => r.id));
    // The foreign org's identically-named company must be invisible here.
    expect(allIds).not.toContain(foreign.id);

    const cluster = body.clusters.find((c) => c.companies.some((r) => r.id === a.id));
    expect(cluster).toBeTruthy();
    expect(cluster!.companies.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(cluster!.reasons).toContain('name');
  });

  skipIfNoDb('company merge re-points FKs, soft-deletes loser, and retry converges', async () => {
    // `domain` is unique per org, so the pair shares a host across the
    // domain/website columns — the realistic import-next-to-manual shape.
    const survivor = await createCompany(orgId!, `Helios Rail Systems ${suffix}`, {
      domain: `helios-rail-${suffix}.example`,
    });
    const loser = await createCompany(orgId!, `HELIOS Rail Systems ${suffix}`, {
      website: `https://www.helios-rail-${suffix}.example`,
    });
    const contact = await prisma.contact.create({
      data: { orgId: orgId!, customer: 'Helios Rail', name: 'Dup Contact', companyId: loser.id },
      select: { id: true },
    });
    const opp = await prisma.opportunity.create({
      data: {
        orgId: orgId!,
        code: `DUP-${suffix}`,
        customer: 'Helios Rail',
        name: 'Signalling framework rebid',
        stage: 's1_lead',
        companyId: loser.id,
      },
      select: { id: true },
    });
    const note = await prisma.note.create({
      data: {
        orgId: orgId!,
        accountId: 'Helios Rail',
        companyId: loser.id,
        authorUserId: seedUserId!,
        title: 'Kickoff notes',
        bodyMd: 'moved on merge',
      },
      select: { id: true },
    });
    const task = await prisma.task.create({
      data: { orgId: orgId!, title: 'Chase SLA annex', accountId: loser.id },
      select: { id: true },
    });

    const payload = { entity: 'company', survivorId: survivor.id, duplicateId: loser.id };
    const first = await server.inject({ method: 'POST', url: '/api/v1/duplicates/merge', payload });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { alreadyMerged: boolean; repointed: Record<string, number> };
    expect(firstBody.alreadyMerged).toBe(false);
    expect(firstBody.repointed).toMatchObject({ contacts: 1, opportunities: 1, notes: 1, tasks: 1 });

    const [movedContact, movedOpp, movedNote, movedTask, tombstonedLoser] = await Promise.all([
      prisma.contact.findUnique({ where: { id: contact.id }, select: { companyId: true } }),
      prisma.opportunity.findUnique({ where: { id: opp.id }, select: { companyId: true } }),
      prisma.note.findUnique({ where: { id: note.id }, select: { companyId: true } }),
      prisma.task.findUnique({ where: { id: task.id }, select: { accountId: true } }),
      // Explicit tombstone probe (the soft-delete middleware hides the loser
      // from unscoped reads): the row must still EXIST, just archived — a
      // hard delete here would break the audit trail.
      prisma.company.findFirst({
        where: { id: loser.id, deletedAt: { not: null } },
        select: { id: true },
      }),
    ]);
    expect(movedContact?.companyId).toBe(survivor.id);
    expect(movedOpp?.companyId).toBe(survivor.id);
    expect(movedNote?.companyId).toBe(survivor.id);
    expect(movedTask?.accountId).toBe(survivor.id);
    expect(tombstonedLoser?.id).toBe(loser.id);

    // Retry after a client timeout must converge, not 404 or double-move.
    const retry = await server.inject({ method: 'POST', url: '/api/v1/duplicates/merge', payload });
    expect(retry.statusCode).toBe(200);
    const retryBody = retry.json() as { alreadyMerged: boolean; repointed: Record<string, number> };
    expect(retryBody.alreadyMerged).toBe(true);
    expect(retryBody.repointed).toMatchObject({ contacts: 0, opportunities: 0, notes: 0, tasks: 0 });
    const stillMoved = await prisma.contact.findUnique({
      where: { id: contact.id },
      select: { companyId: true },
    });
    expect(stillMoved?.companyId).toBe(survivor.id);
  });

  skipIfNoDb('contact merge moves opportunity links and retires unique-conflict links', async () => {
    const survivor = await prisma.contact.create({
      data: { orgId: orgId!, customer: 'Helios Rail', name: `Nadia Ferreira ${suffix}` },
      select: { id: true },
    });
    const loser = await prisma.contact.create({
      data: { orgId: orgId!, customer: 'Helios Rail', name: `NADIA ferreira ${suffix}` },
      select: { id: true },
    });
    const mkOpp = (code: string) =>
      prisma.opportunity.create({
        data: { orgId: orgId!, code, customer: 'Helios Rail', name: code, stage: 's1_lead' },
        select: { id: true },
      });
    const [oppShared, oppLoserOnly] = await Promise.all([
      mkOpp(`DUPC-A-${suffix}`),
      mkOpp(`DUPC-B-${suffix}`),
    ]);
    // Survivor and loser both cover oppShared → the loser's link must be
    // retired, not re-pointed (unique orgId+opportunityId+contactId).
    await prisma.opportunityContact.createMany({
      data: [
        { orgId: orgId!, opportunityId: oppShared.id, contactId: survivor.id },
        { orgId: orgId!, opportunityId: oppShared.id, contactId: loser.id },
        { orgId: orgId!, opportunityId: oppLoserOnly.id, contactId: loser.id },
      ],
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/duplicates/merge',
      payload: { entity: 'contact', survivorId: survivor.id, duplicateId: loser.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { repointed: Record<string, number> };
    expect(body.repointed).toMatchObject({ opportunityLinks: 1, opportunityLinksRetired: 1 });

    const survivorLinks = await prisma.opportunityContact.findMany({
      where: { orgId: orgId!, contactId: survivor.id, deletedAt: null },
      select: { opportunityId: true },
    });
    expect(survivorLinks.map((l) => l.opportunityId).sort()).toEqual(
      [oppShared.id, oppLoserOnly.id].sort(),
    );
    const tombstonedLoser = await prisma.contact.findFirst({
      where: { id: loser.id, deletedAt: { not: null } },
      select: { id: true },
    });
    expect(tombstonedLoser?.id).toBe(loser.id);
  });

  skipIfNoDb(
    'rejects merging a duplicate that is a multi-level ancestor of the survivor — no parentId cycle',
    async () => {
      // WHY: hierarchy A(dup) -> B -> C(survivor). Merging A into C reparents
      // B (A's only child) onto C via repointCompanyRelations, but C still
      // points up at B — minting a B<->C parentId cycle that later hangs
      // GET /companies/:id/hierarchy for every tenant on the process. The old
      // code only special-cased a DIRECT parent, so this two-level case slipped
      // through. The merge must be rejected (409), leaving the chain intact.
      const a = await createCompany(orgId!, `Orion Holdings ${suffix}`);
      const b = await prisma.company.create({
        data: { orgId: orgId!, name: `Orion Rail Div ${suffix}`, source: 'manual', parentId: a.id },
        select: { id: true },
      });
      const c = await prisma.company.create({
        data: {
          orgId: orgId!,
          name: `Orion Signalling ${suffix}`,
          source: 'manual',
          parentId: b.id,
        },
        select: { id: true },
      });

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/duplicates/merge',
        payload: { entity: 'company', survivorId: c.id, duplicateId: a.id },
      });
      expect(res.statusCode).toBe(409);

      // Nothing moved: A still live, B still under A, C still under B — and
      // crucially B and C do NOT point at each other (no cycle was created).
      const [afterA, afterB, afterC] = await Promise.all([
        prisma.company.findUnique({
          where: { id: a.id },
          select: { deletedAt: true },
        }),
        prisma.company.findUnique({ where: { id: b.id }, select: { parentId: true } }),
        prisma.company.findUnique({ where: { id: c.id }, select: { parentId: true } }),
      ]);
      expect(afterA?.deletedAt).toBeNull();
      expect(afterB?.parentId).toBe(a.id);
      expect(afterC?.parentId).toBe(b.id);
    },
  );

  skipIfNoDb('merge with a duplicate from another org 404s — no cross-tenant grafting', async () => {
    const survivor = await createCompany(orgId!, `Vanta Metro Works ${suffix}`);
    const foreign = await createCompany(foreignOrgId!, `Vanta Metro Works ${suffix}`);

    const asDuplicate = await server.inject({
      method: 'POST',
      url: '/api/v1/duplicates/merge',
      payload: { entity: 'company', survivorId: survivor.id, duplicateId: foreign.id },
    });
    expect(asDuplicate.statusCode).toBe(404);

    const asSurvivor = await server.inject({
      method: 'POST',
      url: '/api/v1/duplicates/merge',
      payload: { entity: 'company', survivorId: foreign.id, duplicateId: survivor.id },
    });
    expect(asSurvivor.statusCode).toBe(404);

    const untouched = await prisma.company.findUnique({
      where: { id: foreign.id },
      select: { deletedAt: true, orgId: true },
    });
    expect(untouched?.deletedAt).toBeNull();
    expect(untouched?.orgId).toBe(foreignOrgId);
  });
});
