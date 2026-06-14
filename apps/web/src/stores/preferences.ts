// User UI preferences that aren't theme and aren't ephemeral nav state.
// Currently: density (table/list breathing room), a motion override that
// lets the user force reduced-motion regardless of OS setting, and an
// explicit visual-effects toggle for premium background treatments.
//
// Both ride on `<html>` data attributes so plain CSS can react to them
// without a single component subscribing. Reads/writes go through
// localStorage so the choice survives refresh and is scoped to the signed-in
// user once auth has loaded.

import { create } from 'zustand';

const STORAGE_PREFIX = 'bidstack-prefs.v1';

export type Density = 'compact' | 'comfortable' | 'spacious';
export type MotionPref = 'system' | 'reduced' | 'full';

interface PersistedState {
  density: Density;
  motion: MotionPref;
  visualEffects: boolean;
  // UI sound effects (click / success / error). Interaction-triggered only —
  // never ambient. Volume is 0..1; the sound engine scales its master gain by it.
  sound: boolean;
  soundVolume: number;
}

const DEFAULTS: PersistedState = {
  density: 'comfortable',
  motion: 'system',
  visualEffects: true,
  sound: true,
  soundVolume: 0.4,
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// One place builds the full persisted snapshot from store state, so adding a
// preference doesn't mean editing every setter.
function snapshot(s: PersistedState): PersistedState {
  return {
    density: s.density,
    motion: s.motion,
    visualEffects: s.visualEffects,
    sound: s.sound,
    soundVolume: s.soundVolume,
  };
}

let activeStorageKey = STORAGE_PREFIX;

function storageKeyForUser(userId: string | null): string {
  return userId ? `${STORAGE_PREFIX}:${encodeURIComponent(userId)}` : STORAGE_PREFIX;
}

function parsePersisted(raw: string | null): PersistedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      density: parsed.density ?? DEFAULTS.density,
      motion: parsed.motion ?? DEFAULTS.motion,
      visualEffects:
        typeof parsed.visualEffects === 'boolean' ? parsed.visualEffects : DEFAULTS.visualEffects,
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULTS.sound,
      soundVolume:
        typeof parsed.soundVolume === 'number'
          ? clamp01(parsed.soundVolume)
          : DEFAULTS.soundVolume,
    };
  } catch {
    return null;
  }
}

function read(key = activeStorageKey, fallback = DEFAULTS): PersistedState {
  if (typeof window === 'undefined') return fallback;
  return parsePersisted(localStorage.getItem(key)) ?? fallback;
}

function write(state: PersistedState, key = activeStorageKey): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

function applyToDom(state: PersistedState): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = state.density;
  document.documentElement.dataset.motion = state.motion;
  document.documentElement.dataset.visualEffects = state.visualEffects ? 'on' : 'off';
  document.documentElement.dataset.sound = state.sound ? 'on' : 'off';
}

interface PreferencesStore extends PersistedState {
  setDensity: (d: Density) => void;
  setMotion: (m: MotionPref) => void;
  setVisualEffects: (enabled: boolean) => void;
  setSound: (enabled: boolean) => void;
  setSoundVolume: (volume: number) => void;
  scopeToUser: (userId: string | null) => void;
}

const initial = read();
applyToDom(initial);

export const usePreferences = create<PreferencesStore>((set, get) => ({
  ...initial,
  setDensity: (density) => {
    const next = { ...snapshot(get()), density };
    write(next);
    applyToDom(next);
    set({ density });
  },
  setMotion: (motion) => {
    const next = { ...snapshot(get()), motion };
    write(next);
    applyToDom(next);
    set({ motion });
  },
  setVisualEffects: (visualEffects) => {
    const next = { ...snapshot(get()), visualEffects };
    write(next);
    applyToDom(next);
    set({ visualEffects });
  },
  setSound: (sound) => {
    const next = { ...snapshot(get()), sound };
    write(next);
    applyToDom(next);
    set({ sound });
  },
  setSoundVolume: (volume) => {
    const soundVolume = clamp01(volume);
    const next = { ...snapshot(get()), soundVolume };
    write(next);
    applyToDom(next);
    set({ soundVolume });
  },
  scopeToUser: (userId) => {
    const nextKey = storageKeyForUser(userId);
    if (nextKey === activeStorageKey) return;

    const previousKey = activeStorageKey;
    const current = snapshot(get());

    const migratedFallback =
      userId && previousKey === STORAGE_PREFIX ? read(STORAGE_PREFIX, current) : DEFAULTS;
    activeStorageKey = nextKey;
    const next = read(nextKey, migratedFallback);
    write(next, nextKey);
    applyToDom(next);
    set(next);
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== activeStorageKey || !event.newValue) return;
    const next = parsePersisted(event.newValue);
    if (!next) return;
    applyToDom(next);
    usePreferences.setState(next);
  });
}
