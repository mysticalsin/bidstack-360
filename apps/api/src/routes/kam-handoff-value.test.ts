import { describe, expect, it } from 'vitest';

import { handoffValueFields } from './kam-handoff-value.js';

describe('handoffValueFields', () => {
  it('keeps the exact digits when the number collapses', () => {
    // WHY: the ABC download stored Number(micros), so this deal left as one unit low.
    const micros = 9007199254740993n;
    expect(Number(micros)).toBe(9007199254740992);
    const fields = handoffValueFields(micros);
    expect(fields.valueMicrosText).toBe('9007199254740993');
    expect(fields.valueMicros).toBe(9007199254740992);
  });

  it('keeps a safe amount on both fields', () => {
    expect(handoffValueFields(750_000_000n)).toEqual({
      valueMicros: 750_000_000,
      valueMicrosText: '750000000',
    });
  });
});
