import { describe, expect, it } from 'vitest';

import { commandCenterAmount } from './command-center-amount';

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('command center amount under demo data', () => {
  it('keeps 61520 units and a fractional unit on the decimal', () => {
    // WHY: the weighted value must stay the units the column stored.
    // Grouping is display wording. It must not name EUR or drop a half unit.
    const whole = commandCenterAmount(UNITS_61520_MICROS);
    const half = commandCenterAmount(61_520_500_000);
    expect(whole).not.toMatch(/EUR|€|CAD|CA\$|USD|\$/);
    expect(digits(whole)).toBe('61520');
    expect(half.replace(/[^\d.]/g, '')).toBe('61520.5');
    expect(half).not.toMatch(/EUR|€/);
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a micros value that is not an integer amount is not a price.
    // It must not fall through to an EUR zero.
    expect(commandCenterAmount(Number.NaN)).toBe('Not a number');
    expect(commandCenterAmount(1.5)).toBe('Not a number');
    expect(commandCenterAmount(Number.MAX_SAFE_INTEGER + 2)).toBe('Not a number');
    expect(commandCenterAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
