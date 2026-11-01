import { describe, expect, it } from 'vitest';

import { formatLinkedOpportunityValue } from './RfpAnalyticsSection';

describe('formatLinkedOpportunityValue', () => {
  it('does not label linked opportunity value as euros', () => {
    const label = formatLinkedOpportunityValue('2500000000000');
    expect(label).toContain('unspecified');
    expect(label).not.toMatch(/EUR|€|\$/);
  });

  it('prints a large linked value on the cent', () => {
    // WHY: Number(micros) / 1e6 moved this pipeline total to the next cent.
    expect(formatLinkedOpportunityValue('8598204328457184962')).toBe(
      '8,598,204,328,457.18 unspecified',
    );
  });

  it('shows a blank when the micros string is not a number', () => {
    expect(formatLinkedOpportunityValue('nope')).toBe('—');
  });
});
