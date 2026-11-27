import { describe, expect, it } from 'vitest';

import { pipelineKpiAmount } from './pipeline-kpi-amount';

describe('pipeline total under demo data', () => {
  it('does not price a total pipeline of 61520 as euros', () => {
    // WHY: the deal board total sums opportunity value and prints that
    // number as euros. Those rows do not store a currency. Demo synthetic
    // data sent 61520 units through an EUR formatter, so Total pipeline
    // read as a euro forecast. The figure stays 61520 and does not name EUR.
    const label = pipelineKpiAmount(61520);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the total is not a finite number', () => {
    // WHY: a total that is not a finite number is not a price. It must
    // not fall through to an EUR zero.
    expect(pipelineKpiAmount(Number.NaN)).toBe('Not a number');
    expect(pipelineKpiAmount(Number.POSITIVE_INFINITY)).toBe('Not a number');
    expect(pipelineKpiAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
