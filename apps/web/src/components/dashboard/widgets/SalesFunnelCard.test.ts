import { describe, expect, it } from 'vitest';

import { funnelCountWidths } from './SalesFunnelCard';

describe('funnelCountWidths', () => {
  it('sizes the bars from counts, so a pipeline amount cannot flatten them', () => {
    // WHY: the funnel used the currency amount in the same max as lead counts.
    // A 12 million pipeline made every count bar the minimum width.
    const [leads, opportunities, openDeals] = funnelCountWidths([19, 12, 7]);
    expect(leads).toBe(100);
    expect(opportunities).toBe(63);
    expect(openDeals).toBe(37);
    expect(Math.max(leads ?? 0, opportunities ?? 0, openDeals ?? 0)).toBe(100);
  });

  it('draws an empty count as no bar', () => {
    expect(funnelCountWidths([0, 0, 4])).toEqual([0, 0, 100]);
  });
});
