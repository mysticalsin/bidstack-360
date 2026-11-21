import { describe, expect, it } from 'vitest';

import type { KeyNumber } from '@bidstack/shared';

import { formatPipelineDeals, formatValue } from './positioning-format';

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

  it('does not let a euro formatter replace an unrecorded pipeline tile', () => {
    // WHY: KeyNumbersStrip used to pass an EUR formatter for every micros tile.
    // The open pipeline item has no currency, so that formatter invented euros.
    const tile: KeyNumber = {
      id: 'pipeline',
      group: 'health',
      label: 'Open pipeline',
      value: 1_500_000_000_000,
      unit: 'money_micros',
      currency: null,
      delta: null,
      deltaUnit: null,
      goodWhen: 'up',
      series: [],
      sub: '2 open deals',
      source: 'Polo pipeline',
      period: 'Now',
      sourceUrl: null,
      anchor: 'deals',
      missing: null,
      sample: false,
    };
    const text = formatValue(tile, () => '€1.50bn', 'CAD');
    expect(text).toMatch(/currency not recorded/i);
    expect(text).not.toContain('€');
  });
});
