// Deterministic matchMedia for shell tests. happy-dom evaluates queries
// against its own 1024px window, so tests that depend on the 56rem drawer
// breakpoint or on prefers-reduced-motion pin the answers here instead.
// `setMatch` flips one query later and fires its `change` listeners, the way
// a window resize would.
import { vi } from 'vitest';

type Listener = (event: { matches: boolean; media: string }) => void;

export function mockMatchMedia(initial: Record<string, boolean>): {
  setMatch: (query: string, matches: boolean) => void;
} {
  const state = { ...initial };
  const listeners = new Map<string, Set<Listener>>();
  const forQuery = (query: string) => {
    let set = listeners.get(query);
    if (!set) {
      set = new Set();
      listeners.set(query, set);
    }
    return set;
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return state[query] ?? false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => forQuery(query).add(listener),
      removeEventListener: (_type: string, listener: Listener) => forQuery(query).delete(listener),
      addListener: (listener: Listener) => forQuery(query).add(listener),
      removeListener: (listener: Listener) => forQuery(query).delete(listener),
      dispatchEvent: () => false,
    })),
  );

  return {
    setMatch(query, matches) {
      state[query] = matches;
      for (const listener of forQuery(query)) listener({ matches, media: query });
    },
  };
}
