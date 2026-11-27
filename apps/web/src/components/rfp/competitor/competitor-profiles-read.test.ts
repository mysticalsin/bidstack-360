// A missing competitor catalog is not an empty catalog. Empty is a
// payload that arrived with no names. A later error keeps those names.
import { describe, expect, it } from 'vitest';

import { competitorProfilesPhase } from './competitor-profiles-read';

describe('competitorProfilesPhase', () => {
  it('treats a read with no payload as unread', () => {
    // WHY: a paused query is pending, not loading, and has no data.
    // That shape was the dash in the picker.
    expect(competitorProfilesPhase({ status: 'pending' })).toBe('unread');
    expect(competitorProfilesPhase({})).toBe('unread');
  });

  it('treats a failure with no payload as failed', () => {
    // WHY: the catalog did not arrive. It is not a list of zero names.
    expect(competitorProfilesPhase({ isError: true })).toBe('failed');
    expect(competitorProfilesPhase({ status: 'error' })).toBe('failed');
  });

  it('keeps a payload that arrived, including an empty list and a failed refresh', () => {
    // WHY: empty is a settled miss. Names already in hand stay when a
    // refresh fails, so the picker does not drop back to none.
    expect(competitorProfilesPhase({ data: { items: [] }, status: 'success' })).toBe('ready');
    expect(
      competitorProfilesPhase({
        data: { items: [{ id: 'p1', name: 'Northwind Synthetic' }] },
        isError: true,
        status: 'error',
      }),
    ).toBe('ready');
  });
});
