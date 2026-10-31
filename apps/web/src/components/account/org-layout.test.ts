import { describe, expect, it } from 'vitest';

import { layoutOrg } from './org-layout';

describe('layoutOrg', () => {
  it('puts people under their manager and everyone else under the account', () => {
    const { levels, edges } = layoutOrg([
      { id: 'cio', name: 'CIO', title: null, standing: 'evidenced', reportsToContactId: null },
      { id: 'dir', name: 'Dir', title: null, standing: 'unknown', reportsToContactId: 'cio' },
      { id: 'mgr', name: 'Mgr', title: null, standing: 'unknown', reportsToContactId: 'dir' },
      { id: 'x', name: 'X', title: null, standing: 'stale', reportsToContactId: 'missing' },
    ]);
    expect(levels.map((l) => l.map((p) => p.id))).toEqual([['cio', 'x'], ['dir'], ['mgr']]);
    expect(edges).toBe(2);
  });

  it('survives a reporting cycle', () => {
    const { levels } = layoutOrg([
      { id: 'a', name: 'A', title: null, standing: 'unknown', reportsToContactId: 'b' },
      { id: 'b', name: 'B', title: null, standing: 'unknown', reportsToContactId: 'a' },
    ]);
    expect(levels.flat()).toHaveLength(2);
  });
});
