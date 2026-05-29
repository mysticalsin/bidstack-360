/**
 * migrations.test-helpers.ts
 *
 * Shared test context factory for the migration route integration test suite.
 * Each describe-level test file calls makeMigrationsTestContext() at module top
 * level. The factory registers beforeAll/afterAll for that file's root suite and
 * returns a mutable ctx object plus all shared helper closures.
 *
 * Extracted from migrations.integration.test.ts (BS-R1 file-size refactor).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Cleanup = {
  jobIds: string[];
  companyIds: string[];
  leadIds: string[];
  foreignOrgIds: string[];
};

export type MigrationsTestCtx = {
  server: FastifyInstance;
  seedOrgId: string | null;
  seedUserId: string | null;
  dbReachable: boolean;
  cleanup: Cleanup;
};

// ─── Factory ─────────────────────────────────────────────────────────────────

export function makeMigrationsTestContext() {
  const ctx: MigrationsTestCtx = {
    server: null as unknown as FastifyInstance,
    seedOrgId: null,
    seedUserId: null,
    dbReachable: false,
    cleanup: {
      jobIds: [],
      companyIds: [],
      leadIds: [],
      foreignOrgIds: [],
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

    // Resolve the seed org that the stub auth always resolves to.
    // WHY: auth.ts resolveStubAuth uses org_seed_mantu; we need the DB ID
    //      to create test fixtures in the right org.
    const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
    ctx.seedOrgId = org?.id ?? null;
    if (!ctx.seedOrgId) {
      ctx.dbReachable = false;
      return;
    }

    const user = await prisma.user.findFirst({
      where: { orgId: ctx.seedOrgId },
      orderBy: { createdAt: 'asc' },
    });
    ctx.seedUserId = user?.id ?? null;

    ctx.server = await buildServer();
    await ctx.server.ready();
  });

  afterAll(async () => {
    if (ctx.dbReachable) {
      // Clean up in FK-safe order: child records first.
      if (ctx.cleanup.leadIds.length > 0) {
        await prisma.lead.deleteMany({ where: { id: { in: ctx.cleanup.leadIds } } });
      }
      if (ctx.cleanup.companyIds.length > 0) {
        await prisma.company.deleteMany({ where: { id: { in: ctx.cleanup.companyIds } } });
      }
      if (ctx.cleanup.jobIds.length > 0) {
        await prisma.migrationJob.deleteMany({ where: { id: { in: ctx.cleanup.jobIds } } });
      }
      if (ctx.cleanup.foreignOrgIds.length > 0) {
        // Cascade delete handles jobs + any child records in the foreign orgs.
        await prisma.org.deleteMany({ where: { id: { in: ctx.cleanup.foreignOrgIds } } });
      }
    }
    if (ctx.server) await ctx.server.close();
    if (ctx.dbReachable) await prisma.$disconnect();
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
    it(name, async () => {
      if (!ctx.dbReachable || !ctx.seedOrgId) {
        throw new Error(`[skip] ${name} — DATABASE_URL not reachable or seed org absent`);
      }
      await fn();
    });

  async function createJob(
    overrides: Partial<{
      orgId: string;
      status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'CANCELLED' | 'FAILED';
      undoableUntil: Date | null;
    }> = {},
  ) {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: overrides.orgId ?? ctx.seedOrgId!,
        userId: ctx.seedUserId!,
        source: 'CSV',
        status: overrides.status ?? 'PENDING',
        totalRows: 10,
        processedRows: overrides.status === 'COMPLETE' ? 10 : 0,
        errorRows: 0,
        undoableUntil: overrides.undoableUntil !== undefined ? overrides.undoableUntil : null,
      },
    });

    // Only track own-org jobs in jobIds; foreign-org jobs get cleaned up via
    // org cascade delete.
    const effectiveOrgId = overrides.orgId ?? ctx.seedOrgId!;
    if (effectiveOrgId === ctx.seedOrgId) {
      ctx.cleanup.jobIds.push(job.id);
    }

    return job;
  }

  async function createForeignOrg() {
    const org = await prisma.org.create({
      data: {
        clerkOrg: `org_e2e_migration_${randomUUID()}`,
        name: 'E2E Migration Foreign Tenant',
      },
    });
    ctx.cleanup.foreignOrgIds.push(org.id);
    return org;
  }

  /** Create a Company tagged for migration undo testing. */
  async function createMigrationCompany(jobId: string) {
    const company = await prisma.company.create({
      data: {
        orgId: ctx.seedOrgId!,
        name: `Migration Test Co ${randomUUID().slice(0, 8)}`,
        source: `migration:${jobId}`,
      },
    });
    ctx.cleanup.companyIds.push(company.id);
    return company;
  }

  /** Create a Lead tagged for migration undo testing. */
  async function createMigrationLead(jobId: string) {
    const lead = await prisma.lead.create({
      data: {
        orgId: ctx.seedOrgId!,
        firstName: 'Migration',
        lastName: `Lead ${randomUUID().slice(0, 8)}`,
        companyName: 'Migration Test Corp',
        source: `migration:${jobId}`,
      },
    });
    ctx.cleanup.leadIds.push(lead.id);
    return lead;
  }

  return {
    ctx,
    skipIfNoDb,
    createJob,
    createForeignOrg,
    createMigrationCompany,
    createMigrationLead,
  };
}
