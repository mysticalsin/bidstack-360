import { describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  owner: { owner: true },
  runRetentionSweep: vi.fn(async (_db: unknown, opts: { dryRun: boolean }) => ({
    dryRun: opts.dryRun,
    mode: opts.dryRun ? 'report' : 'enforce',
    classes: [],
  })),
}));
vi.mock('@bidstack/db', () => ({
  prisma: {},
  retentionPrisma: () => dbMocks.owner,
  runRetentionSweep: dbMocks.runRetentionSweep,
  resolveRetentionConfig: (env: Record<string, string | undefined>) => ({
    mode: env.RETENTION_MODE === 'enforce' ? 'enforce' : 'report',
    policies: [],
  }),
}));

import { runRetentionJob } from './retention-sweep.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

// WHY: the scheduled sweep deletes data across every tenant. It must stay a
// report until an operator sets RETENTION_MODE=enforce on purpose.
describe('runRetentionJob', () => {
  it('runs as a dry run by default', async () => {
    const out = await runRetentionJob(log, {});
    expect(dbMocks.runRetentionSweep).toHaveBeenLastCalledWith(dbMocks.owner, expect.objectContaining({ dryRun: true }));
    expect(out.dryRun).toBe(true);
  });

  it('deletes only when RETENTION_MODE=enforce', async () => {
    await runRetentionJob(log, { RETENTION_MODE: 'enforce' });
    expect(dbMocks.runRetentionSweep).toHaveBeenLastCalledWith(dbMocks.owner, expect.objectContaining({ dryRun: false }));
  });
});
