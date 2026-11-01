import { describe, expect, it } from 'vitest';

import { uniqueCompanyLink } from './crm-tools.helpers.js';

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
