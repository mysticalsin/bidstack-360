// Gated accessor for UI sounds. Returns a stable play(kind) that respects the
// user's Sound preference + volume — a no-op when sound is off. Components call
// this instead of soundEngine directly so the toggle is honored in one place.
import { useCallback } from 'react';

import { playUiSound, type UiSoundKind } from '@/lib/soundEngine';
import { usePreferences } from '@/stores/preferences';

export function useUiSound(): (kind: UiSoundKind) => void {
  const sound = usePreferences((s) => s.sound);
  const volume = usePreferences((s) => s.soundVolume);
  return useCallback(
    (kind: UiSoundKind) => {
      if (!sound) return;
      playUiSound(kind, volume);
    },
    [sound, volume],
  );
}
