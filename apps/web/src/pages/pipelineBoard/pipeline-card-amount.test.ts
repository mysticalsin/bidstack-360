import { describe, expect, it } from 'vitest';

import { pipelineCardAmount } from './pipeline-card-amount';

describe('pipeline card value under demo data', () => {
  it('does not price a card value of 61520 as euros', () => {
    // WHY: a deal card prints opportunity value as euros. Those rows do not
    // store a currency. Demo synthetic data sent 61520 units through an EUR
    // formatter, so the card read as a euro price. The figure stays 61520
    // and does not name EUR.
    const label = pipelineCardAmount(61520);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the card value is not a finite number', () => {
    // WHY: a card value that is not a finite number is not a price. It must
    // not fall through to an EUR zero.
    expect(pipelineCardAmount(Number.NaN)).toBe('Not a number');
    expect(pipelineCardAmount(Number.POSITIVE_INFINITY)).toBe('Not a number');
    expect(pipelineCardAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
