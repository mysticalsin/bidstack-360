import { describe, expect, it } from 'vitest';

import { pipelineColumnAmount } from './pipeline-column-amount';

describe('pipeline column total under demo data', () => {
  it('does not price a column total of 61520 as euros', () => {
    // WHY: a stage column sums opportunity value and prints that number as
    // euros. Those rows do not store a currency. Demo synthetic data sent
    // 61520 units through an EUR formatter, so the column total read as a
    // euro forecast. The figure stays 61520 and does not name EUR.
    const label = pipelineColumnAmount(61520);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the column total is not a finite number', () => {
    // WHY: a column total that is not a finite number is not a price. It must
    // not fall through to an EUR zero.
    expect(pipelineColumnAmount(Number.NaN)).toBe('Not a number');
    expect(pipelineColumnAmount(Number.POSITIVE_INFINITY)).toBe('Not a number');
    expect(pipelineColumnAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
