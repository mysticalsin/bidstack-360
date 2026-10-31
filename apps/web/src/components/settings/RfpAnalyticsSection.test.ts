import { describe, expect, it } from 'vitest';

import { formatLinkedOpportunityValue } from './RfpAnalyticsSection';

describe('formatLinkedOpportunityValue', () => {
  it('does not label linked opportunity value as euros', () => {
    const label = formatLinkedOpportunityValue('2500000000000');
    expect(label).toContain('unspecified');
    expect(label).not.toMatch(/EUR|€|\$/);
  });

  it('shows a blank when the micros string is not a number', () => {
    expect(formatLinkedOpportunityValue('nope')).toBe('—');
  });
});
