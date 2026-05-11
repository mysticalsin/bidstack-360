// User UI preferences that aren't theme and aren't ephemeral nav state.
// Currently: density (table/list breathing room) and a motion override that
// lets the user force reduced-motion regardless of OS setting.
//
// Both ride on `<html>` data attributes so plain CSS can react to them
// without a single component subscribing. Reads/writes go through
// localStorage so the choice survives refresh.

import { create } from 'zustand';

const STORAGE_KEY = 'bidstack-prefs.v1';

export type Density = 'compact' | 'comfortable' | 'spacious';
export type MotionPref = 'system' | 'reduced' | 'full';

interface PersistedState {
  density: Density;
  motion: MotionPref;
}

const DEFAULTS: PersistedState = {
  density: 'comfortable',
  motion: 'system',
};

function read(): PersistedState {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      density: parsed.density ?? DEFAULTS.density,
      motion: parsed.motion ?? DEFAULTS.motion,
    };
  } catch {
    return DEFAULTS;
  }
}

function write(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

function applyToDom(state: PersistedState): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = state.density;
  document.documentElement.dataset.motion = state.motion;
}

interface PreferencesStore extends PersistedState {
  setDensity: (d: Density) => void;
  setMotion: (m: MotionPref) => void;
}

const initial = read();
applyToDom(initial);

export const usePreferences = create<PreferencesStore>((set, get) => ({
  ...initial,
  setDensity: (density) => {
    const next = { density, motion: get().motion };
    write(next);
    applyToDom(next);
    set({ density });
  },
  setMotion: (motion) => {
    const next = { density: get().density, motion };
    write(next);
    applyToDom(next);
    set({ motion });
  },
}));
