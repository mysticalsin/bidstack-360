import { describe, expect, it } from 'vitest';

import { buyingGroupPhase } from './buying-group-read';

describe('deal buying group read', () => {
  it('treats a missing payload as unread and a settled empty list as ready', () => {
    // WHY: a paused read has isLoading false and no payload. That is not
    // "No linked contacts". A finished read of nobody stays empty.
    expect(buyingGroupPhase({ isError: false, data: undefined })).toBe('unread');
    expect(buyingGroupPhase({ isError: true, data: undefined })).toBe('error');
    expect(buyingGroupPhase({ isError: true, data: { items: [{ id: 'x' }] } })).toBe('error');
    expect(buyingGroupPhase({ isError: false, data: { items: [] } })).toBe('ready');
    expect(buyingGroupPhase({ isError: false, data: null })).toBe('ready');
  });
});
