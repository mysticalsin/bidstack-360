import { describe, expect, it } from 'vitest';

import type { CrmDeal } from '@bidstack/shared';

import { stageBars } from './AccountStageBars';

function deal(overrides: Partial<CrmDeal> = {}): CrmDeal {
  return {
    id: 'deal-1',
    source: 'external_crm',
    companyId: 'co',
    companyName: 'DNB Bank',
    name: 'Cloud landing zone',
    stage: 'screening',
    amountMicros: 2_700_000_000,
    currencyCode: null,
    probability: null,
    closeDate: null,
    ownerId: null,
    ownerName: null,
    updatedAt: '2026-10-31T12:00:00.000Z',
    ...overrides,
  };
}

describe('stageBars', () => {
  it('sums one account stage without inventing a currency', () => {
    const bars = stageBars([
      deal(),
      deal({ id: 'deal-2', name: 'Second', amountMicros: 300_000_000 }),
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.stage).toBe('screening');
    expect(bars[0]?.count).toBe(2);
    expect(bars[0]?.label).toContain('unspecified');
    expect(bars[0]?.label).not.toMatch(/[$€]/);
  });

  it('keeps a recorded code only when every deal in the stage shares it', () => {
    const bars = stageBars([
      deal({ currencyCode: 'NOK', amountMicros: 1_000_000 }),
      deal({ id: 'deal-2', currencyCode: 'NOK', amountMicros: 1_000_000 }),
    ]);
    expect(bars[0]?.label).toContain('NOK');
    expect(bars[0]?.label).not.toContain('unspecified');
  });
});
