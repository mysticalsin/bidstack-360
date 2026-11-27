import { describe, expect, it } from 'vitest';

import { whoWorksReadKind } from './who-works-read';

describe('whoWorksReadKind', () => {
  it('does not treat a missing payload as an empty group', () => {
    // WHY: a paused or idle relationship-map read has no rows yet. Zero rows
    // here means the payload has not arrived, not that nobody works with them.
    expect(whoWorksReadKind({
      isLoading: false,
      isError: false,
      hasPayload: false,
      rowCount: 0,
    })).toBe('unread');
  });

  it('does not treat a failed read as an empty group', () => {
    // WHY: a failed map must stay a failure even when the row count is zero.
    expect(whoWorksReadKind({
      isLoading: false,
      isError: true,
      hasPayload: false,
      rowCount: 0,
    })).toBe('failed');
  });

  it('keeps a settled map with no work rows empty', () => {
    // WHY: an arrived payload with no MSA, project, or revenue rows is the empty group.
    expect(whoWorksReadKind({
      isLoading: false,
      isError: false,
      hasPayload: true,
      rowCount: 0,
    })).toBe('empty');
  });

  it('keeps a settled map with work rows ready', () => {
    expect(whoWorksReadKind({
      isLoading: false,
      isError: false,
      hasPayload: true,
      rowCount: 2,
    })).toBe('ready');
  });

  it('stays on the skeleton while the first fetch is in flight', () => {
    // WHY: an in-flight read is not the unread sentence and not the empty group.
    expect(whoWorksReadKind({
      isLoading: true,
      isError: false,
      hasPayload: false,
      rowCount: 0,
    })).toBe('loading');
  });
});
