import { describe, expect, it } from 'vitest';

import { visibleIndustryCount } from './company-list-industries';

describe('visibleIndustryCount', () => {
  it('counts one shared demo industry once, and ignores a blank', () => {
    // CI Financial and DNB Bank are both financial_services. A whitespace
    // industry is not a third industry. Counting classified rows would return 3.
    expect(visibleIndustryCount(['financial_services', 'financial_services', '   '])).toBe(1);
  });

  it('counts different industries, and does not invent a shared label', () => {
    expect(visibleIndustryCount(['healthcare', 'insurance', null, undefined, ''])).toBe(2);
    // The card counts the stored string. Title case is a different value.
    expect(visibleIndustryCount(['financial_services', 'Financial Services'])).toBe(2);
  });

  it('is zero when the page has no industry', () => {
    expect(visibleIndustryCount([null, undefined, '', '  '])).toBe(0);
  });
});
