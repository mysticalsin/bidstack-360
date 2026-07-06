// GET /analytics/workload — per-owner aggregation correctness + org scoping.
//
// WHY these assertions matter: this endpoint is the bid lead's Monday-morning
// triage screen. If per-owner math drifts (closed bids counted, weighted
// pipeline mis-multiplied, done tasks counted as overdue) the lead reassigns
// work off a lie; if org scoping leaks, one tenant sees another tenant's
// roster and pipeline value — both are silent, high-blast-radius failures.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

interface WorkloadOwnerRow {
  ownerId: string | null;
  name: string | null;
  email: string | null;
  openBids: number;
  openValueMicros: string;
  weightedValueMicros: string;
  openTasks: number;
  overdueTasks: number;
  closingWithin7Days: number;
}

const DAY_MS = 86_400_000;
const TODAY = new Date();

describe('analytics workload route', () => {
  let server: FastifyInstance | null = null;
  let dbReachable = false;
  let orgId: string | null = null;
  let otherOrgId: string | null = null;
  let restoreAuth: (() => void) | null = null;

  let aliceId: string | null = null;
  let bobId: string | null = null;
  let idleId: string | null = null;
  let charlieId: string | null = null; // other-org owner — must never appear

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }

    const org = await createIsolatedOrg('workload');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const ns = org.namespace;

    // Fresh users so seeded demo data can't pollute per-owner assertions —
    // the isolated org's seed only assigns work to its own seeded users.
    const [alice, bob, idle] = await Promise.all([
      prisma.user.create({
        data: {
          orgId,
          clerkUser: `user_wl_alice_${ns}`,
          email: `alice.${ns}@test.local`,
          name: 'Alice Bidlead',
        },
        select: { id: true },
      }),
      prisma.user.create({
        data: {
          orgId,
          clerkUser: `user_wl_bob_${ns}`,
          email: `bob.${ns}@test.local`,
          name: 'Bob Presales',
        },
        select: { id: true },
      }),
      prisma.user.create({
        data: {
          orgId,
          clerkUser: `user_wl_idle_${ns}`,
          email: `idle.${ns}@test.local`,
          name: 'Ines Available',
        },
        select: { id: true },
      }),
    ]);
    aliceId = alice.id;
    bobId = bob.id;
    idleId = idle.id;

    // Second tenant with its own owner + open bid — the leak canary.
    const otherOrg = await prisma.org.create({
      data: { clerkOrg: `org_wl_other_${ns}`, name: 'Other Org (workload)' },
    });
    otherOrgId = otherOrg.id;
    const charlie = await prisma.user.create({
      data: {
        orgId: otherOrg.id,
        clerkUser: `user_wl_charlie_${ns}`,
        email: `charlie.${ns}@test.local`,
        name: 'Charlie Foreign',
      },
      select: { id: true },
    });
    charlieId = charlie.id;

    const inWeek = new Date(Date.now() + 2 * DAY_MS);
    const farOut = new Date(Date.now() + 30 * DAY_MS);
    await Promise.all([
      // Alice: two open bids (one closing this week), one closed_won (never
      // counted), one soft-deleted open (never counted).
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9701',
          customer: 'Nordbahn AG',
          name: 'Signalling revamp',
          stage: 's2_sent',
          valueMicros: 10_000_000n,
          probability: 50,
          ownerId: aliceId,
          dueDate: inWeek,
        },
      }),
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9702',
          customer: 'Nordbahn AG',
          name: 'Rolling-stock telemetry',
          stage: 's1_ongoing',
          valueMicros: 30_000_000n,
          probability: 10,
          ownerId: aliceId,
          dueDate: farOut,
        },
      }),
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9703',
          customer: 'Nordbahn AG',
          name: 'Won last quarter',
          stage: 'closed_won',
          valueMicros: 99_000_000n,
          probability: 100,
          ownerId: aliceId,
        },
      }),
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9704',
          customer: 'Nordbahn AG',
          name: 'Withdrawn (soft-deleted)',
          stage: 's2_sent',
          valueMicros: 55_000_000n,
          probability: 40,
          ownerId: aliceId,
          deletedAt: new Date(),
        },
      }),
      // Bob: one open bid, no due date.
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9705',
          customer: 'Haventrust Bank',
          name: 'KYC platform bid',
          stage: 's4_negotiation',
          valueMicros: 5_000_000n,
          probability: 100,
          ownerId: bobId,
        },
      }),
      // Bob: one open task due TODAY (UTC). Overdue means the due day has fully
      // passed, so a task due today must NOT count as overdue until tomorrow —
      // a live timestamp comparison would mis-flag it for the whole current day.
      prisma.task.create({
        data: {
          orgId,
          title: 'Send today’s bid clarifications',
          status: 'open',
          assigneeId: bobId,
          dueDate: new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), TODAY.getUTCDate())),
        },
      }),
      // Other org: open bid owned by Charlie — must not leak into org A.
      prisma.opportunity.create({
        data: {
          orgId: otherOrg.id,
          code: 'OP-9706',
          customer: 'Foreign Tenant',
          name: 'Cross-tenant canary',
          stage: 's2_sent',
          valueMicros: 77_000_000n,
          probability: 80,
          ownerId: charlieId,
        },
      }),
      // Alice's tasks: one overdue open, one open due later, one done-overdue
      // (done tasks are never "overdue" — the lead only triages live work).
      prisma.task.create({
        data: { orgId, title: 'Chase legal review', status: 'open', assigneeId: aliceId, dueDate: new Date('2020-01-01') },
      }),
      prisma.task.create({
        data: { orgId, title: 'Draft exec summary', status: 'in_progress', assigneeId: aliceId, dueDate: new Date('2099-01-01') },
      }),
      prisma.task.create({
        data: { orgId, title: 'Submitted pricing annex', status: 'done', assigneeId: aliceId, dueDate: new Date('2020-01-02') },
      }),
      // Unassigned open bid — the "nobody owns this" bucket must surface it.
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9707',
          customer: 'Orphaned Utility',
          name: 'Bid with no owner',
          stage: 's1_lead',
          valueMicros: 7_000_000n,
          probability: 20,
        },
      }),
    ]);

    server = await buildServer();
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    if (server) await server.close();
    if (restoreAuth) restoreAuth();
    if (orgId) await dropIsolatedOrg(orgId);
    if (otherOrgId) await dropIsolatedOrg(otherOrgId);
    if (dbReachable) await prisma.$disconnect();
  }, 30_000);

  const skipIfNoSeed = (name: string, fn: (app: FastifyInstance) => Promise<void> | void) =>
    it(name, async () => {
      if (!dbReachable || !server || !orgId || !aliceId) {
        throw new Error(`[skip] ${name} - isolated org or fixture rows missing`);
      }
      await fn(server);
    });

  async function fetchOwners(app: FastifyInstance): Promise<WorkloadOwnerRow[]> {
    const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/workload' });
    expect(res.statusCode).toBe(200);
    return (res.json() as { owners: WorkloadOwnerRow[] }).owners;
  }

  skipIfNoSeed('aggregates open bids, weighted micros, tasks per owner', async (app) => {
    const owners = await fetchOwners(app);

    const alice = owners.find((o) => o.ownerId === aliceId);
    expect(alice).toBeDefined();
    // Closed and soft-deleted bids excluded; 10M×50% + 30M×10% = 8M weighted.
    expect(alice).toMatchObject({
      name: 'Alice Bidlead',
      openBids: 2,
      openValueMicros: '40000000',
      weightedValueMicros: '8000000',
      closingWithin7Days: 1,
      openTasks: 2,
      overdueTasks: 1,
    });

    const bob = owners.find((o) => o.ownerId === bobId);
    // Bob's one task is due today: it counts as open work but must NOT be
    // overdue — the day hasn't ended. (Regression guard below pins the boundary.)
    expect(bob).toMatchObject({
      openBids: 1,
      weightedValueMicros: '5000000',
      closingWithin7Days: 0,
      openTasks: 1,
      overdueTasks: 0,
    });
  });

  skipIfNoSeed('a task due today is open but not overdue until the day ends', async (app) => {
    // Overdue keys off the start-of-day UTC boundary, not a live timestamp. Under
    // the previous `dueDate < now` logic Bob's today-due task read as overdue for
    // essentially the whole day, telling the bid lead to reassign healthy work.
    const owners = await fetchOwners(app);
    const bob = owners.find((o) => o.ownerId === bobId);
    expect(bob).toBeDefined();
    expect(bob!.openTasks).toBe(1);
    expect(bob!.overdueTasks).toBe(0);
  });

  skipIfNoSeed('lists zero-load members — free capacity is the signal', async (app) => {
    const owners = await fetchOwners(app);
    const idle = owners.find((o) => o.ownerId === idleId);
    // If zero-load reps were dropped, the view could never answer "who can
    // take the next bid" — the entire point of a capacity screen.
    expect(idle).toMatchObject({
      openBids: 0,
      weightedValueMicros: '0',
      openTasks: 0,
      overdueTasks: 0,
    });
  });

  skipIfNoSeed('surfaces the unassigned bucket as ownerId null', async (app) => {
    const owners = await fetchOwners(app);
    const unassigned = owners.find((o) => o.ownerId === null);
    expect(unassigned).toBeDefined();
    // >= because the seeded demo dataset may also contain ownerless rows.
    expect(unassigned!.openBids).toBeGreaterThanOrEqual(1);
  });

  skipIfNoSeed('never leaks another tenant into the roster or the totals', async (app) => {
    const owners = await fetchOwners(app);
    expect(owners.some((o) => o.ownerId === charlieId)).toBe(false);
    expect(owners.some((o) => o.email?.startsWith('charlie.'))).toBe(false);
    // Charlie's 77M bid must not have landed in ANY org-A bucket.
    for (const o of owners) {
      expect(o.openValueMicros).not.toBe('77000000');
    }
  });
});
