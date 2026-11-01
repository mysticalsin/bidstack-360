import { describe, expect, it } from 'vitest';

import { recordedSentiment } from './analysis.service.js';

describe('recordedSentiment', () => {
  it('does not turn a missing model score into a neutral zero', () => {
    expect(recordedSentiment(undefined)).toBeNull();
    expect(recordedSentiment(null)).toBeNull();
    expect(recordedSentiment('0')).toBeNull();
    expect(recordedSentiment(Number.NaN)).toBeNull();
  });

  it('keeps a real zero and clamps the −1…+1 scale', () => {
    expect(recordedSentiment(0)).toBe(0);
    expect(recordedSentiment(0.4)).toBe(0.4);
    expect(recordedSentiment(-0.4)).toBe(-0.4);
    expect(recordedSentiment(4)).toBe(1);
    expect(recordedSentiment(-4)).toBe(-1);
  });
});
