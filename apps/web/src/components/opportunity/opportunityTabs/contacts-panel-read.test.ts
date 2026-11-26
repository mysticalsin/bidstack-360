import { describe, expect, it } from 'vitest';

import { contactsPanelPhase } from './contacts-panel-read';

describe('contactsPanelPhase', () => {
  it('treats an error as failed even when a stale payload is still in hand', () => {
    expect(contactsPanelPhase({ data: { items: [] }, isError: true, status: 'success' })).toBe('failed');
    expect(
      contactsPanelPhase({ data: { items: [{ id: 'ada' }] }, isError: false, status: 'error' }),
    ).toBe('failed');
  });

  it('treats undefined data as unread when the read has not failed', () => {
    expect(contactsPanelPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
  });

  it('treats a settled null payload and a settled list as ready', () => {
    expect(contactsPanelPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(contactsPanelPhase({ data: { items: [] }, isError: false, status: 'success' })).toBe('ready');
  });
});
