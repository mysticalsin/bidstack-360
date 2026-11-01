import { describe, expect, it } from 'vitest';

import { PeopleMap, peopleMapPageNotes } from './people-map.js';

describe('peopleMapPageNotes', () => {
  it('stays silent when the buying group was fully read', () => {
    // WHY: a complete list must not grow a page warning.
    expect(peopleMapPageNotes({})).toEqual([]);
    expect(peopleMapPageNotes(undefined)).toEqual([]);
  });

  it('names each page that stopped early', () => {
    // WHY: the first 200 names were shown as everyone, and the oldest facts decided standing.
    const notes = peopleMapPageNotes({ peopleCapped: true, factsCapped: true, dealsCapped: true, namesCapped: true });
    expect(notes).toEqual([
      'First 1,000 people by name.',
      'Evidence is the latest 1,000 facts.',
      'Deal links are the latest 1,000.',
      'Some reporting names are outside this page.',
    ]);
  });

  it('keeps the page flags on the wire', () => {
    // WHY: the response schema drops a field it does not name, so the list reads as complete.
    const parsed = PeopleMap.parse({
      companyId: '11111111-1111-4111-8111-111111111111',
      opportunityId: null,
      people: [],
      peopleCapped: true,
    });
    expect(parsed.peopleCapped).toBe(true);
  });
});