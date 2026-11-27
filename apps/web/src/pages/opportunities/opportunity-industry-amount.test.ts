import { describe, expect, it } from 'vitest';

import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

import { opportunityIndustryAmount } from './opportunity-industry-amount';

// The demo door's open book is Siemens 1.2m, IKEA 0.85m, Sanofi 2.4m, and
// HSBC 1.75m. Stellantis (won) and Spotify (lost) are not in the industry
// total. Opportunity stores value_micros and no currency. 6.2m micros is
// that sum, not a euro forecast.
const DEMO_OPEN_MICROS = 6_200_000_000_000n;
const SANOFI_MICROS = 2_400_000_000_000n;

describe('opportunityIndustryAmount', () => {
  it('prints the demo open-book total without calling it euros', () => {
    expect(opportunityIndustryAmount(DEMO_OPEN_MICROS)).toBe(formatUnspecifiedAmount(6_200_000));
    expect(opportunityIndustryAmount(DEMO_OPEN_MICROS)).not.toMatch(/EUR|€/);
    expect(opportunityIndustryAmount(SANOFI_MICROS)).toBe(formatUnspecifiedAmount(2_400_000));
    // The segments route sends the sum as a string. That string is the same micros.
    expect(opportunityIndustryAmount(DEMO_OPEN_MICROS.toString())).toBe(
      formatUnspecifiedAmount(6_200_000),
    );
  });
});
