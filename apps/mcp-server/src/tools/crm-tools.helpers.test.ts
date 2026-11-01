import { describe, expect, it } from 'vitest';

import { capPage, storedMicros, uniqueCompanyLink, valueToMicros } from './crm-tools.helpers.js';

describe('valueToMicros', () => {
  it('keeps a string amount as integer micros', () => {
    // WHY: a JSON number cannot carry this remainder into the create call.
    expect(valueToMicros('8598204328457.184962')).toBe(8_598_204_328_457_184_962n);
    expect(valueToMicros(2)).toBe(2_000_000n);
    expect(valueToMicros(54_857_000_000)).toBe(54_857_000_000_000_000n);
    expect(() => valueToMicros('nope')).toThrow(/6 decimal places/);
    expect(() => valueToMicros(Number.MAX_SAFE_INTEGER + 2)).toThrow(/JSON number/);
  });
});

describe('storedMicros', () => {
  it('keeps a digit string when the JSON number collapses', () => {
    // WHY: converting a lead with Math.round(Number) stored this amount one unit low.
    const micros = '9007199254740993';
    expect(Number(micros)).toBe(9007199254740992);
    expect(storedMicros(micros)).toBe(9007199254740993n);
    expect(storedMicros(750_000_000)).toBe(750_000_000n);
    expect(() => storedMicros(Number(micros))).toThrow(/JSON number/);
  });
});

describe('capPage', () => {
  it('does not call a full page the whole match when another row was loaded', () => {
    // WHY: Dust was reading the default page as the pipeline and summing it.
    expect(capPage(['a', 'b', 'c'], 2)).toEqual({ items: ['a', 'b'], limit: 2, truncated: true });
    expect(capPage(['a'], 2)).toEqual({ items: ['a'], limit: 2, truncated: false });
  });
});

describe('uniqueCompanyLink', () => {
  it('links a name only when it matches one company', () => {
    // WHY: Dust was creating people and deals on a customer string. Two
    // companies with that name, or none, must not become a link.
    expect(uniqueCompanyLink([{ id: 'co-1', name: 'CI Financial' }])).toEqual({
      id: 'co-1',
      name: 'CI Financial',
    });
    expect(() => uniqueCompanyLink([])).toThrow(/company id/);
    expect(() =>
      uniqueCompanyLink([
        { id: 'a', name: 'Acme' },
        { id: 'b', name: 'Acme' },
      ]),
    ).toThrow(/company id/);
  });
});
