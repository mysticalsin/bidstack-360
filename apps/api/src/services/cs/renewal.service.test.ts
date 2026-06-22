import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY this test exists: GET /accounts/:id/renewals was dead-on-arrival in
// production — both findMany calls in listRenewalOpportunities were takeless, so
// the unbounded-query guard (QUERY_GUARD_REJECT) turned the response into a 400.
// These assertions fail if either query loses its bound again.

const subscriptionFindMany = vi.fn();
const renewalFindMany = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    subscription: { findMany: subscriptionFindMany },
    renewalOpportunity: { findMany: renewalFindMany },
  },
}));

const { listRenewalOpportunities } = await import('./renewal.service.js');

beforeEach(() => {
  subscriptionFindMany.mockReset().mockResolvedValue([{ id: 'sub-1' }]);
  renewalFindMany.mockReset().mockResolvedValue([]);
});

describe('listRenewalOpportunities query bounds', () => {
  it('bounds both findMany calls with a take ≤ 1000 (avoids the query-guard 400)', async () => {
    await listRenewalOpportunities('org-1', 'acct-1');

    const subArgs = subscriptionFindMany.mock.calls[0]![0] as {
      take?: number;
      where?: Record<string, unknown>;
    };
    expect(typeof subArgs.take).toBe('number');
    expect(subArgs.take!).toBeGreaterThan(0);
    expect(subArgs.take!).toBeLessThanOrEqual(1000);
    expect(subArgs.where).toMatchObject({ orgId: 'org-1', accountId: 'acct-1' });

    const renewalArgs = renewalFindMany.mock.calls[0]![0] as {
      take?: number;
      where?: Record<string, unknown>;
    };
    expect(typeof renewalArgs.take).toBe('number');
    expect(renewalArgs.take!).toBeGreaterThan(0);
    expect(renewalArgs.take!).toBeLessThanOrEqual(1000);
    expect(renewalArgs.where).toMatchObject({ orgId: 'org-1' });
  });
});
