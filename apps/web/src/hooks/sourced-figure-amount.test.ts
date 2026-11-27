import { describe, expect, it } from 'vitest';

import type { KeyNumber } from '@bidstack/shared';

import { sourcedFigureAmount } from './sourced-figure-amount';
import { figureText } from './useSourcedFigures';

const UNITS_61520_MICROS = 61_520_000_000;

function revenue(partial: Pick<KeyNumber, 'value' | 'unit' | 'currency'>): KeyNumber {
  return partial as KeyNumber;
}

function digits(text: string | null): string {
  return (text ?? '').replace(/\D/g, '');
}

describe('sourced revenue under demo data', () => {
  it('does not price a sourced revenue of 61520 as euros', () => {
    // WHY: figureText prints money_micros as euros. The key number does not
    // carry a currency. Demo synthetic data sent 61520 units through an EUR
    // formatter, so a sourced revenue read as a euro forecast. The figure
    // stays 61520 and does not name EUR. A figure that already names a
    // currency stays on the compact formatter it already used.
    const text = figureText(
      revenue({ value: UNITS_61520_MICROS, unit: 'money_micros', currency: null }),
    );
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
    expect(
      figureText(revenue({ value: 1_700_000_000, unit: 'money', currency: 'EUR' })),
    ).toBe('EUR 1.7B');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a sourced revenue that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero.
    expect(sourcedFigureAmount(Number.NaN)).toBe('Not a number');
    expect(sourcedFigureAmount(1.5)).toBe('Not a number');
    expect(sourcedFigureAmount('nope')).toBe('Not a number');
    expect(sourcedFigureAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
