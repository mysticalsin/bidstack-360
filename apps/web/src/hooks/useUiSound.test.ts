import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/soundEngine', () => ({ playUiSound: vi.fn() }));

import { playUiSound } from '@/lib/soundEngine';
import { usePreferences } from '@/stores/preferences';

import { useUiSound } from './useUiSound';

const initial = usePreferences.getState();

beforeEach(() => {
  vi.clearAllMocks();
  usePreferences.setState({ sound: true, soundVolume: 0.4 });
});
afterEach(() => usePreferences.setState(initial));

describe('useUiSound', () => {
  it('does not play when the Sound preference is off', () => {
    usePreferences.setState({ sound: false });
    const { result } = renderHook(() => useUiSound());
    act(() => result.current('click'));
    expect(playUiSound).not.toHaveBeenCalled();
  });

  it('plays the requested sound at the configured volume when on', () => {
    usePreferences.setState({ sound: true, soundVolume: 0.6 });
    const { result } = renderHook(() => useUiSound());
    act(() => result.current('success'));
    expect(playUiSound).toHaveBeenCalledWith('success', 0.6);
  });
});
