import { beforeEach, describe, expect, it, vi } from 'vitest';

// A health score of 20 used to be stored as LOW_USAGE. Usage was never measured.
// This fails if the nightly pass writes that kind again.

const healthFindMany = vi.fn();
const churnCreate = vi.fn();
const expansionCreate = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    healthScore: { findMany: healthFindMany },
    churnSignal: { findFirst: vi.fn(), create: churnCreate },
    expansionOpportunity: { findFirst: vi.fn().mockResolvedValue(null), create: expansionCreate },
  },
}));

const { runOrgChurnDetection, surfaceExpansionOpportunities } = await import('./index.js');

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  healthFindMany.mockReset().mockResolvedValue([{ accountId: 'acct-1', score: 20 }]);
  churnCreate.mockReset();
  expansionCreate.mockReset().mockResolvedValue({ id: 'exp-1' });
});

describe('customer-success honesty', () => {
  it('does not store a health score as a low-usage churn signal', async () => {
    healthFindMany.mockResolvedValue([{ accountId: 'acct-1', score: 20 }]);
    const created = await runOrgChurnDetection('org-1', log);
    expect(created).toBe(0);
    expect(churnCreate).not.toHaveBeenCalled();
  });

  it('does not let an auto-surfaced expansion inherit the euro column default', async () => {
    healthFindMany.mockResolvedValue([{ accountId: 'acct-1', score: 90 }]);
    const created = await surfaceExpansionOpportunities('org-1', log);
    expect(created).toBe(1);
    const data = (expansionCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.currency).toBe('XXX');
    expect(data.valueMicros).toBeUndefined();
  });

  it('does not expand from an old high score after the latest score dropped', async () => {
    // WHY: the query kept any row at 80 or above. A stale 90 still opened
    // an expansion after the current score was 40.
    healthFindMany.mockResolvedValue([
      { accountId: 'acct-1', score: 90, capturedAt: new Date('2026-01-01T00:00:00.000Z') },
      { accountId: 'acct-1', score: 40, capturedAt: new Date('2026-06-01T00:00:00.000Z') },
    ]);
    const created = await surfaceExpansionOpportunities('org-1', log);
    expect(created).toBe(0);
    expect(expansionCreate).not.toHaveBeenCalled();
  });
});
