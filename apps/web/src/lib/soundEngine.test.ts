import { describe, expect, it } from 'vitest';

import { playUiSound } from './soundEngine';

// jsdom has no AudioContext, so getContext() returns null and every call must be
// a silent no-op that never throws into a click handler.
describe('playUiSound', () => {
  it('no-ops without an AudioContext and never throws', () => {
    expect(() => playUiSound('click', 0.5)).not.toThrow();
    expect(() => playUiSound('success', 0.5)).not.toThrow();
    expect(() => playUiSound('error', 0.5)).not.toThrow();
    expect(() => playUiSound('toggle', 0.5)).not.toThrow();
  });

  it('returns early at zero volume', () => {
    expect(() => playUiSound('click', 0)).not.toThrow();
  });
});
