// Deterministic matchMedia for shell tests. happy-dom evaluates queries
// against its own 1024px window, so tests that depend on the 56rem drawer
// breakpoint or on prefers-reduced-motion pin the answers here instead.
import { vi } from 'vitest';

export function mockMatchMedia(matches: Record<string, boolean>): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
}
