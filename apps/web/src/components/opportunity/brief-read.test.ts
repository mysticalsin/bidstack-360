import { describe, expect, it } from 'vitest';

import { briefReadPhase } from './brief-read';

describe('briefReadPhase', () => {
  it('treats an error as failed even when a stale brief is still in hand', () => {
    expect(briefReadPhase({ data: { brief: 'stale' }, isError: true, status: 'success' })).toBe(
      'failed',
    );
    expect(
      briefReadPhase({ data: { brief: 'stale' }, isError: false, status: 'error' }),
    ).toBe('failed');
  });

  it('treats undefined data as unread when the read has not failed', () => {
    expect(briefReadPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
    expect(briefReadPhase({ data: undefined, isError: false, status: 'idle' })).toBe('unread');
  });

  it('treats a settled null payload and a settled brief as ready', () => {
    expect(briefReadPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(
      briefReadPhase({ data: { brief: '' }, isError: false, status: 'success' }),
    ).toBe('ready');
  });
});
