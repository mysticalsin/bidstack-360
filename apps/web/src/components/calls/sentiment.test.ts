import { describe, expect, it } from 'vitest';

import { sentimentFigure, sentimentTone } from './sentiment';

describe('call sentiment scale', () => {
  it('treats zero as neutral, not a negative percent', () => {
    // WHY: the badge used to multiply the −1…+1 score by 100 and call
    // anything under 40% negative. A missing score coerced to 0 then read as 0% negative.
    expect(sentimentTone(0)).toBe('neutral');
    expect(sentimentFigure(0)).toBe('0.00');
    expect(sentimentTone(-0.1)).toBe('neutral');
    expect(sentimentTone(0.2)).toBe('neutral');
  });

  it('keeps a clearly positive or negative score on the signed scale', () => {
    expect(sentimentTone(0.8)).toBe('positive');
    expect(sentimentFigure(0.8)).toBe('+0.80');
    expect(sentimentTone(-0.6)).toBe('negative');
    expect(sentimentFigure(-0.6)).toBe('-0.60');
  });
});
