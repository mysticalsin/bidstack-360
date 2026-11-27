import { describe, expect, it } from 'vitest';

import { accountCardPipelineAmount } from './account-card-pipeline-amount';

const UNITS_61520_MICROS = 61_520_000_000;

describe('account card pipeline under demo data', () => {
  it('does not price an account card pipeline of 61520 as euros', () => {
    // WHY: the account card prices open pipeline as euros. The summed
    // figure does not store a currency. Demo synthetic data sent 61520
    // units through an EUR formatter, so the pipeline read as a euro
    // forecast. The figure stays 61520 and does not name EUR.
    const label = accountCardPipelineAmount(UNITS_61520_MICROS);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the pipeline micros are not a safe integer', () => {
    // WHY: a pipeline that is not an integer micros value is not a price.
    // It must not fall through to an EUR zero.
    expect(accountCardPipelineAmount(Number.NaN)).toBe('Not a number');
    expect(accountCardPipelineAmount(1.5)).toBe('Not a number');
    expect(accountCardPipelineAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
