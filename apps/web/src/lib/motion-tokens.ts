// UI motion tokens (DESIGN.md 9.2). Adapted from TUFFUI motion-tokens
// (https://github.com/yurigdesigner/tuffui, MIT, commit 378f3eaa).
//
// Same curves as the `--ease-ui-*` / `--ease-drawer` @theme tokens in
// src/index.css, and the same durations as `--duration-enter` (210ms) and
// `--duration-exit` (150ms); motion-tokens.test.ts keeps the two in step.
// Springs for pages and dialogs stay in ./motion.ts.

/** Strong ease-out for anything entering, hovering or pressed. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Ease-in-out for movement on screen (reorder, slide). */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
/** Drawers and sheets. Same curve as `easeStandard` in ./motion.ts. */
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const CSS_EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const CSS_EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
export const CSS_EASE_DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Bounce-free spring for layout and morphs. */
export const spring = { type: 'spring', duration: 0.3, bounce: 0 } as const;

export const enter = { duration: 0.21, ease: EASE_OUT } as const;
export const exit = { duration: 0.15, ease: EASE_OUT } as const;

/** Keyboard-initiated changes and reduced motion. */
export const instant = { duration: 0 } as const;

/** Pick `instant` when the user asked for reduced motion (pass `useReducedMotion()`). */
export function motionFor<T>(reduced: boolean | null | undefined, transition: T): T | typeof instant {
  return reduced ? instant : transition;
}
