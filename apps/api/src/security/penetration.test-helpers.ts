/**
 * penetration.test-helpers.ts
 *
 * Shared test context factory for the penetration test suite.
 * Each describe-level test file calls makePentestContext() at module top level.
 * The factory registers beforeAll/afterAll for that file's root suite and
 * returns a mutable ctx object plus skipIfNoDb.
 *
 * Extracted from penetration.test.ts (BS-R1 file-size refactor).
 */

import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Cleanup = {
  orgIds: string[];
  opportunityIds: string[];
  subscriptionIds: string[];
  syncEventTypes: string[];
};

export type PentestCtx = {
  server: FastifyInstance;
  dbReachable: boolean;
  seedOrgId: string | null;
  seedUserId: string | null;
  seedAdminEmail: string | null;
  foreignOrgId: string | null;
  foreignOpportunityId: string | null;
  ownOpportunityId: string | null;
  previousDustSecret: string | undefined;
  cleanup: Cleanup;
};

// ─── HMAC helper ─────────────────────────────────────────────────────────────

/** Sign a webhook body string with the given secret (sha256 prefix). */
export function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function makePentestContext() {
  const ctx: PentestCtx = {
    server: null as unknown as FastifyInstance,
    dbReachable: false,
    seedOrgId: null,
    seedUserId: null,
    seedAdminEmail: null,
    foreignOrgId: null,
    foreignOpportunityId: null,
    ownOpportunityId: null,
    previousDustSecret: undefined,
    cleanup: {
      orgIds: [],
      opportunityIds: [],
      subscriptionIds: [],
      syncEventTypes: [],
    },
  };

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      ctx.dbReachable = true;
    } catch {
      ctx.dbReachable = false;
      return;
    }

    ctx.previousDustSecret = process.env.DUST_WEBHOOK_SECRET;

    const seedOrg = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
    ctx.seedOrgId = seedOrg?.id ?? null;
    if (!ctx.seedOrgId) {
      ctx.dbReachable = false;
      return;
    }

    const seedUser = await prisma.user.findFirst({
      where: { orgId: ctx.seedOrgId },
      orderBy: { createdAt: 'asc' },
    });
    ctx.seedUserId = seedUser?.id ?? null;
    ctx.seedAdminEmail = seedUser?.email ?? null;

    // Cross-tenant fixture: a second org with an opportunity that the seed user
    // must NOT be able to read, update, or enumerate.
    const foreignOrg = await prisma.org.create({
      data: { clerkOrg: `org_pentest_${randomUUID()}`, name: 'Pentest Foreign Org' },
    });
    ctx.foreignOrgId = foreignOrg.id;
    ctx.cleanup.orgIds.push(foreignOrg.id);

    const foreignOpp = await prisma.opportunity.create({
      data: {
        orgId: foreignOrg.id,
        code: `OP-${String(Math.floor(Math.random() * 8999) + 1000)}`,
        customer: 'PENTEST-FOREIGN',
        name: 'Cross-tenant probe target',
        stage: 's1_lead',
        valueMicros: BigInt(0),
        probability: 0,
        industry: 'other',
      },
    });
    ctx.foreignOpportunityId = foreignOpp.id;
    ctx.cleanup.opportunityIds.push(foreignOpp.id);

    // A live opportunity owned by the seed org so we can verify mass-assignment
    // protection on a record the request IS allowed to touch.
    const ownOpp = await prisma.opportunity.create({
      data: {
        orgId: ctx.seedOrgId,
        code: `OP-${String(Math.floor(Math.random() * 8999) + 1000)}`,
        customer: 'PENTEST-OWN',
        name: 'Mass-assignment probe target',
        stage: 's1_lead',
        valueMicros: BigInt(0),
        probability: 0,
        industry: 'other',
      },
    });
    ctx.ownOpportunityId = ownOpp.id;
    ctx.cleanup.opportunityIds.push(ownOpp.id);

    ctx.server = await buildServer();
    await ctx.server.ready();
  });

  afterAll(async () => {
    if (ctx.dbReachable) {
      if (ctx.cleanup.opportunityIds.length > 0) {
        await prisma.opportunity.deleteMany({
          where: { id: { in: ctx.cleanup.opportunityIds } },
        });
      }
      if (ctx.cleanup.subscriptionIds.length > 0) {
        await prisma.webhookSubscription.deleteMany({
          where: { id: { in: ctx.cleanup.subscriptionIds } },
        });
      }
      if (ctx.cleanup.syncEventTypes.length > 0) {
        await prisma.syncEvent.deleteMany({
          where: { eventType: { in: ctx.cleanup.syncEventTypes } },
        });
      }
      if (ctx.cleanup.orgIds.length > 0) {
        await prisma.org.deleteMany({ where: { id: { in: ctx.cleanup.orgIds } } });
      }
    }
    if (ctx.previousDustSecret === undefined) delete process.env.DUST_WEBHOOK_SECRET;
    else process.env.DUST_WEBHOOK_SECRET = ctx.previousDustSecret;
    if (ctx.server) await ctx.server.close();
    if (ctx.dbReachable) await prisma.$disconnect();
  });

  const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
    it(name, async () => {
      if (!ctx.dbReachable || !ctx.seedOrgId) {
        throw new Error(`[skip] ${name} — DATABASE_URL not reachable or seed missing`);
      }
      await fn();
    });

  return { ctx, skipIfNoDb };
}
