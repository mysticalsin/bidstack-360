import { describe, expect, it } from 'vitest';

import { catalogPhase } from './policy-catalog-read';

describe('catalogPhase', () => {
  it('treats paused, idle, and in-flight reads as not arrived', () => {
    expect(catalogPhase({ status: 'pending', fetchStatus: 'paused' })).toBe('unread');
    expect(catalogPhase({ status: 'pending', fetchStatus: 'idle' })).toBe('unread');
    expect(catalogPhase({ status: 'pending', fetchStatus: 'fetching' })).toBe('unread');
  });

  it('treats a failed read with no payload as failed, and keeps names already in hand', () => {
    expect(catalogPhase({ status: 'error', fetchStatus: 'idle' })).toBe('failed');
    expect(
      catalogPhase({
        status: 'error',
        fetchStatus: 'idle',
        items: ['Admin'],
      }),
    ).toBe('ready');
  });

  it('keeps a settled empty list empty, including during a refetch', () => {
    expect(catalogPhase({ status: 'success', fetchStatus: 'idle', items: [] })).toBe('empty');
    expect(catalogPhase({ status: 'success', fetchStatus: 'fetching', items: [] })).toBe('empty');
  });

  it('keeps a successful payload while a later read is in flight', () => {
    expect(
      catalogPhase({ status: 'success', fetchStatus: 'fetching', items: ['France'] }),
    ).toBe('ready');
  });
});
