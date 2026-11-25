import { describe, expect, it } from 'vitest';

import { isOwnFollowUp, ownListEmpty, showOwnQuickAdd } from './task-own-filter';

// The fixture book assigns "Submit revised pricing & SoW v2" to Alex and the
// Logistec workshop to Blake. A Mine view is Alex's rows only. A different
// capitalisation of the same address is still Alex. An unassigned follow-up
// is not his, and a missing viewer must not be treated as everyone.
const ALEX = 'alex.example@example.test';
const BLAKE = 'blake.sample@example.test';

describe('isOwnFollowUp', () => {
  it('keeps Alex’s pricing follow-up and drops Blake’s workshop', () => {
    expect(isOwnFollowUp({ assignee: ALEX }, ALEX)).toBe(true);
    expect(isOwnFollowUp({ assignee: BLAKE }, ALEX)).toBe(false);
  });

  it('matches the owner address ignoring case and surrounding space', () => {
    expect(isOwnFollowUp({ assignee: '  Alex.Example@Example.Test ' }, ALEX)).toBe(true);
  });

  it('does not treat an unassigned follow-up or an unknown viewer as a match', () => {
    expect(isOwnFollowUp({ assignee: null }, ALEX)).toBe(false);
    expect(isOwnFollowUp({ assignee: ALEX }, null)).toBe(false);
    expect(isOwnFollowUp({ assignee: ALEX }, '   ')).toBe(false);
  });
});

describe('ownListEmpty', () => {
  it('says the loaded rows belong to other people when Mine is empty', () => {
    expect(ownListEmpty('mine', 0, [{ assignee: BLAKE }], ALEX)).toEqual({ kind: 'others' });
  });

  it('says the viewer is unknown when Mine has no address to match', () => {
    expect(ownListEmpty('mine', 0, [{ assignee: BLAKE }], null)).toEqual({
      kind: 'unknown-viewer',
    });
  });

  it('stays quiet when Mine already has a row, the filter is not Mine, or the book is empty', () => {
    expect(ownListEmpty('mine', 1, [{ assignee: ALEX }], ALEX)).toEqual({ kind: 'hidden' });
    expect(ownListEmpty('all', 0, [{ assignee: BLAKE }], ALEX)).toEqual({ kind: 'hidden' });
    expect(ownListEmpty('mine', 0, [], ALEX)).toEqual({ kind: 'hidden' });
  });
});

describe('showOwnQuickAdd', () => {
  it('hides quick-add on an empty Mine view so an unassigned save is not a silent miss', () => {
    expect(showOwnQuickAdd('mine', 0)).toBe(false);
  });

  it('keeps quick-add on All and on a Mine view that already lists a row', () => {
    expect(showOwnQuickAdd('all', 0)).toBe(true);
    expect(showOwnQuickAdd('mine', 1)).toBe(true);
  });
});
