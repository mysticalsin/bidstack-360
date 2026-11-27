import { describe, expect, it } from 'vitest';

import { taskBidLinkMessage, taskBidLinkPhase } from './task-bid-link';

const NOT_A_MISS = /\b(0|zero|empty|none|no bids)\b/i;

describe('taskBidLinkPhase', () => {
  it('does not treat a missing bid payload as an empty link list', () => {
    // A paused read often arrives with no rows and isLoading false.
    expect(
      taskBidLinkPhase({ isError: false, hasPayload: false, count: 0 }),
    ).toBe('unread');
    expect(taskBidLinkMessage('unread')).toBe('Checking bids to link.');
    expect(taskBidLinkMessage('unread')).not.toMatch(NOT_A_MISS);
  });

  it('does not treat a failed bid read as an empty link list', () => {
    expect(
      taskBidLinkPhase({ isError: true, hasPayload: false, count: 0 }),
    ).toBe('failed');
    expect(taskBidLinkMessage('failed')).not.toMatch(NOT_A_MISS);
  });

  it('keeps an arrived empty bid book empty', () => {
    expect(
      taskBidLinkPhase({ isError: false, hasPayload: true, count: 0 }),
    ).toBe('empty');
  });

  it('keeps an arrived bid', () => {
    expect(
      taskBidLinkPhase({ isError: false, hasPayload: true, count: 1 }),
    ).toBe('ready');
  });

  it('keeps an arrived bid when a later refresh fails', () => {
    expect(
      taskBidLinkPhase({ isError: true, hasPayload: true, count: 1 }),
    ).toBe('ready');
  });
});
