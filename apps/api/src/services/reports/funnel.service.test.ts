import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY this test exists: getPipelineKpis feeds the pipeline-by-stage KPI card.
// The per-stage `valueSum` was computed as `Number(bigint) / 1_000_000`, which
// rounds the BigInt→Number conversion *before* the division runs — so once a
// single stage's aggregated pipeline exceeds Number.MAX_SAFE_INTEGER micros
// (~$9.007B, entirely plausible when aggregating mega-contracts) the reported
// total silently diverges from the true Postgres SUM. The assertion below pins
// an aggregate above that threshold to its exact value; it fails if the code
// ever regresses to the precision-losing Number() conversion.

const opportunityGroupBy = vi.fn();
const opportunityCount = vi.fn();
const queryRaw = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    opportunity: { groupBy: opportunityGroupBy, count: opportunityCount },
    $queryRaw: queryRaw,
  },
  // Prisma.sql is used as a tagged template in the service; a passthrough is
  // enough since $queryRaw itself is mocked.
  Prisma: { sql: (...args: unknown[]) => args },
}));

const { getPipelineKpis } = await import('./funnel.service.js');

beforeEach(() => {
  opportunityGroupBy.mockReset();
  opportunityCount.mockReset().mockResolvedValue(0);
  queryRaw.mockReset().mockResolvedValue([{ weightedMicros: '0', avgDaysOpen: 0, openCount: 0 }]);
});

describe('getPipelineKpis money precision', () => {
  it('divides a per-stage sum above Number.MAX_SAFE_INTEGER micros exactly', async () => {
    // 600_000_000_001 EUR → 6.00000000001e17 micros. This bigint is NOT exactly
    // representable as a JS double, so `Number(micros) / 1_000_000` yields
    // 600000000000.9999 (wrong). The BigInt-safe helper must yield exactly
    // 600_000_000_001.
    const bigSumMicros = 600_000_000_001_000_000n;

    opportunityGroupBy.mockResolvedValue([
      { stage: 'proposal', _count: { _all: 1 }, _sum: { valueMicros: bigSumMicros } },
    ]);

    const result = await getPipelineKpis('org-1');

    expect(result.byStage[0]!.valueSum).toBe(600_000_000_001);
    // `proposal` is an open stage, so the rollup must be exact too.
    expect(result.totalValueOpen).toBe(600_000_000_001);
    // Sanity: the naive Number(bigint)/1e6 path would have produced a value that
    // is strictly not equal to the exact result — guards the test's own premise.
    expect(Number(bigSumMicros) / 1_000_000).not.toBe(600_000_000_001);
  });

  it('scopes the groupBy query to the caller org and excludes soft-deleted rows', async () => {
    opportunityGroupBy.mockResolvedValue([]);

    await getPipelineKpis('org-42');

    const args = opportunityGroupBy.mock.calls[0]![0] as { where?: Record<string, unknown> };
    expect(args.where).toMatchObject({ orgId: 'org-42', deletedAt: null });
  });

  it('converts a weighted micros total above the float64 safe range exactly', async () => {
    // WHY: the SQL used to divide value_micros in float8 before summing.
    // 600_000_000_001 currency units at probability 100 is
    // 6.00000000001e17 micros, which a float64 sum cannot hold. The query
    // now returns that integer as text and microsToUnits splits it in BigInt.
    opportunityGroupBy.mockResolvedValue([]);
    queryRaw.mockResolvedValue([
      { weightedMicros: '600000000001000000', avgDaysOpen: 0, openCount: 1 },
    ]);

    const result = await getPipelineKpis('org-1');

    expect(result.weightedPipeline).toBe(600_000_000_001);
    expect(Number(600_000_000_001_000_000n) / 1_000_000).not.toBe(600_000_000_001);
  });
});
