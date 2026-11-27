import { describe, expect, it } from 'vitest';

import { readPhase } from './read-phase';

describe('readPhase', () => {
  it('keeps a paused or in-flight read unread, and a settled null ready', () => {
    // WHY: isLoading is false for a paused read. Treating that as empty hides
    // the seeded companies. A settled null is a real empty result.
    expect(readPhase({ isError: false, data: undefined })).toBe('unread');
    expect(readPhase({ isError: true, data: undefined })).toBe('error');
    expect(readPhase({ isError: true, data: { companies: 4 } })).toBe('error');
    expect(readPhase({ isError: false, data: null })).toBe('ready');
    expect(readPhase({ isError: false, data: { companies: 0 } })).toBe('ready');
  });
});
