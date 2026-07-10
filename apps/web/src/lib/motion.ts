// Apple-grade motion tokens. All animations across the app should reach for
// these constants rather than inventing one-offs. The spring curves are
// modeled after Apple's UIKit defaults (UISpringTimingParameters), tuned for
// the perceptual densities we use in Polo PreSales.
//
// Naming follows Apple HIG: "snap" for buttons/affordances (≤200ms), "smooth"
// for view transitions, "soft" for ambient/hero motion (cockpit reveal).
//
// Respect prefers-reduced-motion: callers should check `prefersReducedMotion`
// (or use `useReducedMotion()` from framer-motion) and short-circuit to a
// zero-duration tween. The primitives in components/motion/* do this for you.

import type { Transition, Variants } from 'framer-motion';

// ── Springs ──────────────────────────────────────────────────────────────

/** Tap/button feedback. Critically damped, lands in ~160ms. Apple's
 *  default "snap" feel for control state changes. */
export const springSnap: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 32,
  mass: 0.6,
};

/** Modal / dialog entrance. Slight overshoot, settles ~280ms. */
export const springModal: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 28,
  mass: 0.8,
};

/** Page / view transitions. Smooth, decisive. */
export const springSmooth: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 30,
  mass: 0.9,
};

/** Ambient reveals (scroll into view, hero numbers). Gentle, no bounce. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 180,
  damping: 26,
  mass: 1,
};

/** Layout/FLIP animations. Matches Apple's UIView animate-layout default. */
export const springLayout: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 36,
  mass: 0.7,
};

// ── Eases (when a tween is more appropriate than a spring) ──────────────

/** Apple's standard ease curve. Use for opacity-only fades. */
export const easeStandard: Transition = {
  duration: 0.24,
  ease: [0.32, 0.72, 0, 1],
};

/** Decelerate-only — content arriving onto screen. */
export const easeDecel: Transition = {
  duration: 0.32,
  ease: [0, 0.72, 0.32, 1],
};

/** Accelerate-only — content leaving the screen. */
export const easeAccel: Transition = {
  duration: 0.18,
  ease: [0.32, 0, 1, 0.28],
};

// ── Common variants ──────────────────────────────────────────────────────

export const fadeUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -4, transition: easeAccel },
};

export const fadeScale: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: springModal },
  exit: { opacity: 0, scale: 0.98, transition: easeAccel },
};

export const slideRight: Variants = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0, transition: springSmooth },
  exit: { opacity: 0, x: 12, transition: easeAccel },
};

/** Parent-side variants for a stagger container. Children should use one
 *  of the *child* variants below. The stagger is 32ms — fast enough to feel
 *  cohesive, slow enough to read sequence. */
export const staggerParent: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.032,
      delayChildren: 0.04,
    },
  },
};

export const staggerChild: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: springSoft },
};

// ── Hover/press primitives (use with `whileHover` / `whileTap`) ─────────

export const hoverLift = {
  y: -2,
  transition: springSnap,
} as const;

export const hoverGlow = {
  boxShadow: '0 12px 32px rgba(16, 24, 40, 0.10)',
  transition: springSnap,
} as const;

export const tapDown = {
  scale: 0.97,
  transition: springSnap,
} as const;

// ── Utility: detect reduced motion at module import time ────────────────
// (Components should also use framer-motion's useReducedMotion hook for
// reactive updates if the user toggles their OS setting mid-session.)

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
