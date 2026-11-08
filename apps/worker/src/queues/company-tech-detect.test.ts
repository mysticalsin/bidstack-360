import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgFindMany = vi.fn();
const companyFindMany = vi.fn();
const enrichmentFindMany = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    org: { findMany: orgFindMany },
    company: { findMany: companyFindMany },
    companyEnrichment: { findMany: enrichmentFindMany },
  },
  refreshCompanyOpenTechStack: vi.fn(),
}));

const { sweepTechStacks, techStackStale, techSweepJobId } = await import('./company-tech-detect.js');

const NOW = new Date('2026-11-07T12:00:00.000Z');
const log = { info: vi.fn(), warn: vi.fn() } as never;

function snapshot(checkedAt: string, sample = false) {
  return { openTechStack: { version: 1, checkedAt, sample, items: [], lanes: [], apolloFallback: null } };
}

describe('techStackStale', () => {
  const cutoff = new Date('2026-11-01T00:00:00.000Z');
  it('treats missing, sample and old snapshots as stale', () => {
    expect(techStackStale(null, cutoff)).toBe(true);
    expect(techStackStale({ openTechStack: 'junk' }, cutoff)).toBe(true);
    expect(techStackStale(snapshot('2026-11-05T00:00:00.000Z', true), cutoff)).toBe(true);
    expect(techStackStale(snapshot('2026-10-20T00:00:00.000Z'), cutoff)).toBe(true);
  });
  it('keeps a fresh real snapshot', () => {
    expect(techStackStale(snapshot('2026-11-05T00:00:00.000Z'), cutoff)).toBe(false);
  });
});

describe('sweepTechStacks', () => {
  beforeEach(() => {
    orgFindMany.mockReset();
    companyFindMany.mockReset();
    enrichmentFindMany.mockReset();
  });

  it('queues stale accounts per org with a weekly job id and skips fresh ones', async () => {
    orgFindMany.mockResolvedValue([{ id: 'org-1' }]);
    companyFindMany.mockResolvedValueOnce([
      { id: 'c-fresh', name: 'Fresh Co' },
      { id: 'c-stale', name: 'Stale Co' },
      { id: 'c-new', name: 'New Co' },
    ]);
    enrichmentFindMany.mockResolvedValue([
      { normalizedName: 'fresh-co', providerMetadata: snapshot('2026-11-06T00:00:00.000Z') },
      { normalizedName: 'stale-co', providerMetadata: snapshot('2026-10-01T00:00:00.000Z') },
    ]);
    const add = vi.fn().mockResolvedValue({ id: 'x' });
    const res = await sweepTechStacks({ add } as never, {}, log, NOW);
    expect(res.enqueued).toBe(2);
    expect(add.mock.calls.map((c) => c[1].companyId)).toEqual(['c-stale', 'c-new']);
    expect(add.mock.calls[0]![2]).toEqual({ jobId: techSweepJobId('org-1', 'c-stale', NOW) });
    expect(companyFindMany.mock.calls[0]![0].where.orgId).toBe('org-1');
    expect(enrichmentFindMany.mock.calls[0]![0].where.orgId).toBe('org-1');
  });

  it('stops at the batch limit', async () => {
    orgFindMany.mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]);
    companyFindMany.mockResolvedValue([
      { id: 'a', name: 'A Co' },
      { id: 'b', name: 'B Co' },
    ]);
    enrichmentFindMany.mockResolvedValue([]);
    const add = vi.fn().mockResolvedValue({ id: 'x' });
    const res = await sweepTechStacks({ add } as never, { TECH_STACK_SWEEP_LIMIT: '1' }, log, NOW);
    expect(res.enqueued).toBe(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('gives the same job id within a week, so a restarted sweep never doubles up', () => {
    const later = new Date(NOW.getTime() + 60 * 60_000);
    expect(techSweepJobId('o', 'c', NOW)).toBe(techSweepJobId('o', 'c', later));
  });
});
