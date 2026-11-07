import { describe, expect, it } from 'vitest';

import { RELATED_CAP, relatedCount } from './relatedCount';

describe('relatedCount', () => {
  it('shows exact counts under the API cap', () => {
    expect(relatedCount(0)).toBe('0');
    expect(relatedCount(RELATED_CAP - 1)).toBe(String(RELATED_CAP - 1));
  });

  it('marks a full page as a lower bound, not a total', () => {
    expect(relatedCount(RELATED_CAP)).toBe(`${RELATED_CAP}+`);
  });
});
