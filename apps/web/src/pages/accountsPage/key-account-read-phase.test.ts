import { describe, expect, it } from 'vitest';

import { keyAccountReadPhase } from './key-account-read-phase';

describe('key account read phase', () => {
  it('treats a read with no payload as still loading, not an empty page', () => {
    // WHY: zero key accounts is a finished answer. The first paint has no page yet.
    expect(keyAccountReadPhase({ hasPayload: false, isLoading: true, isError: false })).toBe(
      'loading',
    );
    expect(keyAccountReadPhase({ hasPayload: false, isLoading: false, isError: false })).toBe(
      'loading',
    );
  });

  it('treats a failed first read as an error', () => {
    // WHY: failure is not "no key accounts yet".
    expect(keyAccountReadPhase({ hasPayload: false, isLoading: false, isError: true })).toBe(
      'error',
    );
  });

  it('keeps a payload that is already on screen when a later refresh fails', () => {
    // WHY: the page the reader is looking at is still the page.
    expect(keyAccountReadPhase({ hasPayload: true, isLoading: false, isError: true })).toBe(
      'stale',
    );
    expect(keyAccountReadPhase({ hasPayload: true, isLoading: false, isError: false })).toBe(
      'ready',
    );
  });
});
