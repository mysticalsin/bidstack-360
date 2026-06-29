// Integration tests — DELETE /api/v1/migrations/:id/undo
//
// Key invariants verified:
//   - 200 with deletedCount for own-org undoable COMPLETE job
//   - Tagged rows are actually gone from the DB after undo
//   - 409 if job is not COMPLETE (wrong state)
//   - 410 if undo window is expired (undoableUntil in past)
//   - 410 if undoableUntil is null (window never enabled)
//   - 404 for cross-org job (tenant isolation)
//   - 404 for non-existent UUID
//   - Only deletes own-org tagged rows (cross-org guard on deleteMany)

import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const {
  ctx,
  skipIfNoDb,
  createJob,
  createForeignOrg,
  createMigrationCompany,
  createMigrationLead,
} = makeMigrationsTestContext();

describe('DELETE /api/v1/migrations/:id/undo', () => {
  skipIfNoDb('deletes tagged records and returns deletedCount', async () => {
    const undoableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24 h
    const job = await createJob({ status: 'COMPLETE', undoableUntil });

    // Seed the rows the undo operation should remove.
    const company = await createMigrationCompany(job.id);
    const lead = await createMigrationLead(job.id);

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ message: string; deletedCount: number }>();
    // WHY: deletedCount must reflect the exact rows removed so callers can
    //      confirm the undo worked without a follow-up query.
    expect(body.deletedCount).toBe(2); // 1 company + 1 lead

    // Verify the rows are actually gone from the database.
    const companyRow = await prisma.company.findUnique({ where: { id: company.id } });
    expect(companyRow).toBeNull();
    const leadRow = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(leadRow).toBeNull();

    // Remove from cleanup lists — already deleted by undo.
    ctx.cleanup.companyIds.splice(ctx.cleanup.companyIds.indexOf(company.id), 1);
    ctx.cleanup.leadIds.splice(ctx.cleanup.leadIds.indexOf(lead.id), 1);
  });

  skipIfNoDb('returns 409 when job is not COMPLETE', async () => {
    const job = await createJob({ status: 'RUNNING' });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    // WHY: undo only makes sense after all rows have been committed; attempting
    //      it mid-run would produce unpredictable partial-delete results.
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb('returns 410 when undo window is expired', async () => {
    const undoableUntil = new Date(Date.now() - 1000); // 1 s ago
    const job = await createJob({ status: 'COMPLETE', undoableUntil });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    // WHY: 410 Gone communicates that the resource existed but the capability
    //      is permanently gone — distinct from 409 (wrong state) and 404 (not found).
    expect(res.statusCode).toBe(410);
  });

  skipIfNoDb('returns 410 when undoableUntil is null (window never set)', async () => {
    const job = await createJob({ status: 'COMPLETE', undoableUntil: null });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    // null undoableUntil is treated the same as expired — undo was never enabled.
    expect(res.statusCode).toBe(410);
  });

  skipIfNoDb('returns 404 for cross-org job', async () => {
    const foreignOrg = await createForeignOrg();
    const undoableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const foreignJob = await createJob({ orgId: foreignOrg.id, status: 'COMPLETE', undoableUntil });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${foreignJob.id}/undo`,
    });
    // WHY: cross-tenant isolation — a caller must not be able to undo another
    //      org's import, even if they somehow know the job UUID.
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('returns 404 for non-existent UUID', async () => {
    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${randomUUID()}/undo`,
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('only deletes own-org tagged rows (cross-org guard)', async () => {
    const undoableUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const job = await createJob({ status: 'COMPLETE', undoableUntil });

    // Create a company in a FOREIGN org that coincidentally carries the same
    // sourceTag format — undo must NOT delete it.
    const foreignOrg = await createForeignOrg();
    const foreignCompany = await prisma.company.create({
      data: {
        orgId: foreignOrg.id,
        name: `Foreign Migration Co ${randomUUID().slice(0, 8)}`,
        source: `migration:${job.id}`,
      },
    });

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/undo`,
    });
    expect(res.statusCode).toBe(200);

    // deletedCount should be 0 — no rows in the isolated org carry this tag.
    const body = res.json<{ deletedCount: number }>();
    expect(body.deletedCount).toBe(0);

    // Foreign company must survive.
    const surviving = await prisma.company.findUnique({ where: { id: foreignCompany.id } });
    expect(surviving).not.toBeNull();

    // Clean up the foreign company (the org cascade won't fire until afterAll).
    await prisma.company.delete({ where: { id: foreignCompany.id } });
  });
});
