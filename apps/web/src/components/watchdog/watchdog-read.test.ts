import { describe, expect, it } from 'vitest';

import { watchdogPanelState } from './watchdog-read';

describe('watchdogPanelState', () => {
  it('keeps a payload that is already on screen, even when a refresh fails or is still running', () => {
    expect(watchdogPanelState({ hasPayload: true, isLoading: true, isError: false })).toBe('ready');
    expect(watchdogPanelState({ hasPayload: true, isLoading: false, isError: true })).toBe('ready');
  });

  it('treats a read with no payload as loading, then as an error, and an empty success as ready', () => {
    expect(watchdogPanelState({ hasPayload: false, isLoading: true, isError: false })).toBe('loading');
    expect(watchdogPanelState({ hasPayload: false, isLoading: false, isError: true })).toBe('error');
    expect(watchdogPanelState({ hasPayload: false, isLoading: false, isError: false })).toBe('ready');
  });
});
