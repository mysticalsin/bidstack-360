import { describe, expect, it } from 'vitest';

import { activeFollowUpCount } from './task-active-count';

describe('activeFollowUpCount', () => {
  it('uses the book open count once the summary has settled', () => {
    // A loaded page of two rows (one of them done) is not the book.
    expect(
      activeFollowUpCount({
        isLoading: false,
        isError: false,
        data: { open: 4 },
      }),
    ).toEqual({ phase: 'ready', active: 4 });
  });

  it('keeps the last open count while a later summary refresh is in flight', () => {
    expect(
      activeFollowUpCount({
        isLoading: true,
        isError: false,
        data: { open: 4 },
      }),
    ).toEqual({ phase: 'ready', active: 4 });
  });

  it('does not treat a missing summary as an empty book', () => {
    expect(
      activeFollowUpCount({ isLoading: true, isError: false, data: undefined }),
    ).toEqual({ phase: 'pending' });
    expect(
      activeFollowUpCount({ isLoading: false, isError: true, data: undefined }),
    ).toEqual({ phase: 'error' });
  });
});
