// Jarvis opens from three doors: the Topbar mic, Cmd+J and the palette. All
// of them go through this store, so the hotkey and the prompt hand-off from
// the palette are pinned here.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useJarvisHotkey, useJarvisStore } from './jarvisStore';

afterEach(() => {
  act(() => useJarvisStore.getState().close());
});

function press(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}

describe('useJarvisHotkey', () => {
  it('toggles Jarvis on Cmd+J and Ctrl+J', () => {
    renderHook(() => useJarvisHotkey());
    press({ key: 'j', metaKey: true });
    expect(useJarvisStore.getState().open).toBe(true);
    press({ key: 'J', ctrlKey: true });
    expect(useJarvisStore.getState().open).toBe(false);
  });

  it('ignores a bare j', () => {
    renderHook(() => useJarvisHotkey());
    press({ key: 'j' });
    expect(useJarvisStore.getState().open).toBe(false);
  });
});

describe('openJarvis', () => {
  it('carries the palette prompt into the panel', () => {
    act(() => useJarvisStore.getState().openJarvis('Which bids are overdue?'));
    expect(useJarvisStore.getState()).toMatchObject({
      open: true,
      draft: 'Which bids are overdue?',
    });
  });
});
