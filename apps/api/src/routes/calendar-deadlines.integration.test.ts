import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

// WHY a far-future fixed window: the isolated org is seeded with demo
// opportunities/proposals whose dueDates cluster around "now". Asserting exact
// membership against a 2031 window keeps the test deterministic — only the
// rows this file creates can fall inside it.
const WINDOW_FROM = '2031-04-06';
const WINDOW_TO = '2031-04-13'; // exclusive

describe('calendar deadlines route', () => {
  let server: FastifyInstance | null = null;
  let dbReachable = false;
  let orgId: string | null = null;
  let otherOrgId: string | null = null;
  let restoreAuth: (() => void) | null = null;

  let inWindowOppId: string | null = null;
  let closedOppId: string | null = null;
  let outOfWindowOppId: string | null = null;
  let inWindowProposalId: string | null = null;
  let otherOrgOppId: string | null = null;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }

    const org = await createIsolatedOrg('caldeadlines');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

    // Bare second org (no seed needed) to prove org scoping.
    const otherOrg = await prisma.org.create({
      data: { clerkOrg: `org_caldl_other_${org.namespace}`, name: 'Other Org (deadlines)' },
    });
    otherOrgId = otherOrg.id;

    const [inWindow, closed, outOfWindow, otherOrgOpp] = await Promise.all([
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9801',
          customer: 'Deadline Corp',
          name: 'In-window open bid',
          stage: 's2_sent',
          dueDate: new Date('2031-04-08'),
        },
        select: { id: true },
      }),
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9802',
          customer: 'Deadline Corp',
          name: 'In-window but closed won',
          stage: 'closed_won',
          dueDate: new Date('2031-04-09'),
        },
        select: { id: true },
      }),
      prisma.opportunity.create({
        data: {
          orgId,
          code: 'OP-9803',
          customer: 'Deadline Corp',
          name: 'Open bid outside the window',
          stage: 's2_sent',
          dueDate: new Date('2031-04-20'),
        },
        select: { id: true },
      }),
      prisma.opportunity.create({
        data: {
          orgId: otherOrg.id,
          code: 'OP-9804',
          customer: 'Foreign Tenant',
          name: 'Other-org bid in window',
          stage: 's2_sent',
          dueDate: new Date('2031-04-08'),
        },
        select: { id: true },
      }),
    ]);
    inWindowOppId = inWindow.id;
    closedOppId = closed.id;
    outOfWindowOppId = outOfWindow.id;
    otherOrgOppId = otherOrgOpp.id;

    const proposal = await prisma.proposal.create({
      data: {
        orgId,
        name: 'In-window proposal',
        status: 'draft',
        dueDate: new Date('2031-04-10'),
      },
      select: { id: true },
    });
    inWindowProposalId = proposal.id;

    server = await buildServer();
    await server.ready();
  }, 30_000);

  afterAll(async () => {
    if (server) await server.close();
    if (restoreAuth) restoreAuth();
    if (orgId) await dropIsolatedOrg(orgId);
    if (otherOrgId) await dropIsolatedOrg(otherOrgId);
    if (dbReachable) await prisma.$disconnect();
  }, 30_000);

  const skipIfNoSeed = (name: string, fn: (app: FastifyInstance) => Promise<void> | void) =>
    it(name, async () => {
      if (!dbReachable || !server || !orgId || !inWindowOppId || !inWindowProposalId) {
        throw new Error(`[skip] ${name} - isolated org or fixture rows missing`);
      }
      await fn(server);
    });

  // WHY this is the load-bearing assertion: the whole feature exists so a bid
  // manager opening the calendar sees submission deadlines. If the merge drops
  // opportunities or proposals, or leaks closed bids / other tenants' rows,
  // the lane silently lies about the week's bid clock.
  skipIfNoSeed(
    'GET /calendar/deadlines returns open opp + proposal deadlines in window, org-scoped',
    async (app) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/deadlines?from=${WINDOW_FROM}&to=${WINDOW_TO}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ kind: string; id: string; dueDate: string; code: string | null }>;
      };
      const ids = body.items.map((i) => i.id);

      expect(ids).toContain(inWindowOppId);
      expect(ids).toContain(inWindowProposalId);
      // Closed bids have no live deadline.
      expect(ids).not.toContain(closedOppId);
      // Window is [from, to) — later dueDates stay out.
      expect(ids).not.toContain(outOfWindowOppId);
      // Multi-tenancy: another org's rows never leak.
      expect(ids).not.toContain(otherOrgOppId);

      const opp = body.items.find((i) => i.id === inWindowOppId);
      expect(opp).toMatchObject({ kind: 'opportunity', code: 'OP-9801', dueDate: '2031-04-08' });
      const proposal = body.items.find((i) => i.id === inWindowProposalId);
      expect(proposal).toMatchObject({ kind: 'proposal', dueDate: '2031-04-10' });

      // Sorted by dueDate so the lane renders chronologically without
      // client-side re-sorting.
      const dates = body.items.map((i) => i.dueDate);
      expect(dates).toEqual([...dates].sort());
    },
  );

  skipIfNoSeed('GET /calendar/deadlines rejects an inverted window', async (app) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/calendar/deadlines?from=${WINDOW_TO}&to=${WINDOW_FROM}`,
    });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoSeed('GET /calendar/deadlines rejects a non-date from/to', async (app) => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/calendar/deadlines?from=not-a-date&to=2031-04-13',
    });
    expect(res.statusCode).toBe(400);
  });
});
