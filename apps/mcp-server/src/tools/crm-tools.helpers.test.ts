import { describe, expect, it } from 'vitest';

import { uniqueCompanyLink, valueToMicros } from './crm-tools.helpers.js';

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
