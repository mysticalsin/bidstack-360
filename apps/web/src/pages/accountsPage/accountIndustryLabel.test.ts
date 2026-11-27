import { describe, expect, it } from 'vitest';

import { accountIndustryLabel } from './accountIndustryLabel';

describe('accountIndustryLabel', () => {
  it('prints the demo financial_services code as words', () => {
    // WHY: CI Financial and DNB are stored as financial_services. The All
    // accounts list already says Financial Services. Key and Top were still
    // showing the code, and a filter must keep sending that code.
    expect(accountIndustryLabel('financial_services')).toBe('Financial Services');
    expect(accountIndustryLabel('healthcare')).toBe('Healthcare');
    expect(accountIndustryLabel('Financial Services')).toBe('Financial Services');
    expect(accountIndustryLabel('  pharmaceuticals  ')).toBe('Pharmaceuticals');
  });
});
