import { describe, expect, it } from 'vitest';

import { pipelineStageAmount } from './pipeline-stage-amount';

describe('pipeline stage value under demo data', () => {
  it('does not price a stage value of 61520 as euros', () => {
    // WHY: the portfolio pipeline card prints a stage value as euros. Those
    // rows do not store a currency. Demo synthetic data sent 61520 units
    // through an EUR formatter, so a stage read as a euro forecast. The
    // figure stays 61520 and does not name EUR.
    const label = pipelineStageAmount(61520);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the stage value is not a finite number', () => {
    // WHY: a stage value that is not a finite number is not a price. It
    // must not fall through to an EUR zero.
    expect(pipelineStageAmount(Number.NaN)).toBe('Not a number');
    expect(pipelineStageAmount(Number.POSITIVE_INFINITY)).toBe('Not a number');
    expect(pipelineStageAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
