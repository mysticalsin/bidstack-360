import { describe, expect, it } from 'vitest';

import { averageLeadScoreLabel } from './LeadsPage';

describe('averageLeadScoreLabel', () => {
  it('does not show 0 when the list is empty', () => {
    expect(averageLeadScoreLabel([])).toBe('—');
  });

  it('averages the scores that are on the list', () => {
    expect(averageLeadScoreLabel([80, 60])).toBe('70');
  });
});
