import { describe, expect, it } from 'vitest';

import { shapeBuyingGroup } from './shapeBuyingGroup';

describe('shapeBuyingGroup', () => {
  it('returns nothing when no one is linked', () => {
    expect(shapeBuyingGroup([])).toBeNull();
  });

  it('draws one link per person and does not treat a title as a node', () => {
    // Why: a CEO title is not evidence. The diagram may only show standing
    // and the person, and each band is one person rather than a score.
    const diagram = shapeBuyingGroup([
      { id: 'a', name: 'Ada', standing: 'unknown' },
      { id: 'b', name: 'Bea', standing: 'unknown' },
      { id: 'c', name: 'Ada', standing: 'evidenced' },
    ]);
    expect(diagram).not.toBeNull();
    expect(diagram?.nodes.map((node) => node.name)).toEqual([
      'This opportunity',
      'Unknown',
      'Evidenced',
      'Ada',
      'Bea',
      'Ada (2)',
    ]);
    expect(diagram?.links.every((link) => link.value === 1)).toBe(true);
    expect(diagram?.links).toHaveLength(6);
    expect(diagram?.nodes.some((node) => node.name.toLowerCase().includes('ceo'))).toBe(false);
  });
});
