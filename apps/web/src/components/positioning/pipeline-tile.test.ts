import { describe, expect, it } from 'vitest';

import { formatPipelineDeals } from './positioning-format';

describe('open pipeline tile', () => {
  it('shows currency not recorded for mixed-currency deals when no rate is recorded', () => {
    // WHY: the tile summed every deal and printed euros. There is no approved
    // rate, so a euro deal and a Canadian deal cannot become one CAD total.
    // PR #64 review on positioning-format.ts. Superseded by #374.
    const text = formatPipelineDeals(
      [
        { micros: '1000000000000', currency: 'EUR' },
        { micros: '500000000000', currency: 'CAD' },
      ],
      'CAD',
    );
    expect(text).toMatch(/currency not recorded/i);
    expect(text).not.toMatch(/€/);
    expect(text).not.toContain('CA$');
  });
});
