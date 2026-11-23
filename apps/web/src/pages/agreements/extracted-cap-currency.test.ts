import { describe, expect, it } from 'vitest';

import { extractMsaFields } from '@bidstack/shared';

import { formatExtractedMicros } from './IntakeReviewPage';

describe('extracted liability cap with no currency', () => {
  it('renders unspecified instead of EUR', () => {
    // WHY: extract-fields defaulted a bare amount to EUR, and the review
    // then printed "500,000 EUR" for a cap the MSA never denominated.
    const fields = extractMsaFields(
      'The aggregate liability of the Supplier is capped at 500,000 under this agreement.',
    );
    const cap = fields.liabilityCap.value as { amountMicros: number; currency: string | null };
    const label = formatExtractedMicros(cap.amountMicros, cap.currency);
    expect(label).toBe('500,000 unspecified');
    expect(label).not.toContain('EUR');
  });
});
