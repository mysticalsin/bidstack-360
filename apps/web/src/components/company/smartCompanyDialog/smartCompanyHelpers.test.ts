import { describe, expect, it } from 'vitest';

import { recordedConfidencePercent, recordedFill } from './smartCompanyHelpers';

describe('recordedConfidencePercent', () => {
  it('does not turn a typed domain into a confidence score', () => {
    expect(recordedConfidencePercent(undefined)).toBeNull();
    expect(recordedConfidencePercent(null)).toBeNull();
    expect(recordedConfidencePercent(Number.NaN)).toBeNull();
  });

  it('shows a stored company confidence as a percent', () => {
    expect(recordedConfidencePercent(0.55)).toBe(55);
  });
});

describe('recordedFill', () => {
  it('fills the bar only when the field is actually recorded', () => {
    expect(recordedFill(true)).toBe(100);
    expect(recordedFill(false)).toBe(0);
  });
});
