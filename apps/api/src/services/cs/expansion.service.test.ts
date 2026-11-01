import { beforeEach, describe, expect, it, vi } from 'vitest';

// A healthy starter plan used to store ARR / 2 as an upsell and ARR / 10 as a
// renewal uplift, copied in the subscription currency. Those figures were not
// measured. This fails if either create writes a value or a real currency.

const subscriptionFindMany = vi.fn();
const subscriptionFindFirst = vi.fn();
const healthFindFirst = vi.fn();
const expansionFindFirst = vi.fn();
const expansionCreate = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    subscription: { findMany: subscriptionFindMany, findFirst: subscriptionFindFirst },
    healthScore: { findFirst: healthFindFirst },
    expansionOpportunity: { findFirst: expansionFindFirst, create: expansionCreate },
  },
}));

const { surfaceExpansionOpportunities } = await import('./expansion.service.js');

beforeEach(() => {
  subscriptionFindMany.mockReset().mockResolvedValue([
    {
      accountId: 'acct-1',
      planTier: 'starter',
      arrAmountMicros: 2_000_000_000_000n,
      currency: 'EUR',
    },
  ]);
  healthFindFirst.mockReset().mockResolvedValue({ score: 90 });
  expansionFindFirst.mockReset().mockResolvedValue(null);
  subscriptionFindFirst.mockReset().mockResolvedValue({ id: 'sub-1' });
  expansionCreate.mockReset().mockResolvedValue({ id: 'exp-1' });
});

describe('surfaceExpansionOpportunities', () => {
  it('does not store an invented uplift or the subscription currency', async () => {
    const created = await surfaceExpansionOpportunities('org-1', { info: vi.fn() } as never);

    expect(created).toBe(2);
    expect(expansionCreate).toHaveBeenCalledTimes(2);
    for (const call of expansionCreate.mock.calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data.valueMicros).toBeUndefined();
      expect(data.currency).toBe('XXX');
      expect(String(data.notes)).not.toMatch(/50%|10%|EUR/);
    }
  });
});
