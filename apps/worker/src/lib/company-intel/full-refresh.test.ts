import type * as FullRefreshNs from './full-refresh.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class EnrichmentRateLimitedError extends Error {}
  return {
    EnrichmentRateLimitedError,
    runAccountEnrichment: vi.fn(),
    runAccountIntel: vi.fn(),
    recompute: vi.fn(),
    markBatch: vi.fn(),
  };
});

vi.mock('@bidstack/db', () => ({
  intelConnections: () => ({ publicSources: true, apollo: true }),
  markImportBatchCompany: mocks.markBatch,
  recomputeCompanyIntelSummary: mocks.recompute,
  prisma: { intelSourceRun: { findFirst: vi.fn(async () => null) } },
}));
vi.mock('../../account-enrichment/job.js', () => ({
  EnrichmentRateLimitedError: mocks.EnrichmentRateLimitedError,
  runAccountEnrichment: mocks.runAccountEnrichment,
}));
vi.mock('../account-intel/run.js', () => ({ runAccountIntel: mocks.runAccountIntel }));
vi.mock('../account-intel/prisma-store.js', () => ({ prismaIntelStore: () => ({}) }));

// The worker config runs files with isolate: false, so import after mocking.
let runCompanyFullRefresh: typeof FullRefreshNs.runCompanyFullRefresh;
beforeAll(async () => {
  vi.resetModules();
  ({ runCompanyFullRefresh } = await import('./full-refresh.js'));
});

const NOW = new Date('2026-11-07T12:00:00.000Z');
const JOB = {
  kind: 'full-refresh',
  orgId: '22222222-2222-4222-8222-222222222222',
  companyId: '33333333-3333-4333-8333-333333333333',
  batchId: '44444444-4444-4444-8444-444444444444',
  force: true,
} as unknown as FullRefreshNs.FullRefreshQueueJob;
const deps = {
  env: {},
  now: () => NOW,
  intel: {} as never,
  apollo: {} as never,
} as FullRefreshNs.FullRefreshDeps;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runAccountIntel.mockResolvedValue({});
  mocks.recompute.mockResolvedValue({ companyId: JOB.companyId });
  mocks.markBatch.mockResolvedValue('running');
  mocks.runAccountEnrichment.mockRejectedValue(new mocks.EnrichmentRateLimitedError('429'));
});

describe('runCompanyFullRefresh when Apollo rate limits', () => {
  it('saves the public data, then rethrows so the queue retries, without settling the batch', async () => {
    await expect(runCompanyFullRefresh(JOB, deps, { finalAttempt: false })).rejects.toBeInstanceOf(
      mocks.EnrichmentRateLimitedError,
    );
    expect(mocks.recompute).toHaveBeenCalledOnce();
    expect(mocks.markBatch).not.toHaveBeenCalled();
  });

  it('settles the company on the last attempt and reports the rate limit', async () => {
    const res = await runCompanyFullRefresh(JOB, deps, { finalAttempt: true });
    expect(res.apollo).toBe('rate_limited');
    expect(mocks.markBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: true }));
  });
});
