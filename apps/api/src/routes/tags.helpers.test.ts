import { describe, expect, it } from 'vitest';

import { suggestTagsLocally } from './tags.helpers';

describe('suggestTagsLocally', () => {
  it('matches words in the text without inventing a confidence score', () => {
    const suggestions = suggestTagsLocally('This renewal is urgent for a public sector bid', [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Renewal' },
    ]);
    expect(suggestions.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Renewal', 'Public Sector']),
    );
    expect(suggestions.every((item) => item.confidence === null)).toBe(true);
  });
});
