// Icon micro-motion lookup — the re-keyed half of ROUND2-ULTRAPLAN amendment 7.
//
// Split out of Icon.tsx purely for the 400-line file budget: Icon.tsx is 330
// lines of SVG path data before a single behaviour line. Nothing else imports
// this module directly — Icon.tsx re-exports the public names so every existing
// `@/components/ui/Icon` import keeps working untouched.
//
// The type-only import of IconName is erased at compile time, so the pair is
// not a runtime cycle.

import type { IconName } from './Icon';

// ─── Micro-motion ─────────────────────────────────────────────────────────────
//
// ROUND2-ULTRAPLAN amendment 7: the CRM's icon.tsx is NOT ported (it is Carbon-
// glyph-based and would drag React 19 and 342 call-site edits behind it). What
// crosses over is only its MOTION_BY_ICON lookup (D:\CRM\packages\ui\src\
// components\icon.tsx:35-69, fallback "pop" :75-78), RE-KEYED from Carbon's
// PascalCase glyph names onto BidStack's own semantic names below.
//
// The stamp is a `cds-icon` class + a `data-motion` verb on the <svg>. The CSS
// that reads them lives in index.css ("Grafted rhythm — icon motion"), where the
// transform is declared as a custom property and only APPLIED on hover of the
// icon or of the interactive ancestor that owns it. That indirection is the
// whole trick: one attribute here animates every one of the 342 `<Icon name=`
// call sites across 128 files with zero call-site edits.

export const ICON_MOTIONS = [
  'pop',
  'scale',
  'lift',
  'turn',
  'rotate',
  'flip',
  'spin',
  'wiggle',
  'swing',
  'bounce',
  'pulse',
  'nudge-right',
  'nudge-left',
  'nudge-up',
  'nudge-down',
  'launch',
  'none',
] as const;

export type IconMotion = (typeof ICON_MOTIONS)[number];

// Semantics, not shapes: the verb describes what the icon DOES, so "go forward"
// glyphs nudge forward and "destructive" glyphs shake. Names absent here fall
// back to "pop" — the same default the source used.
const MOTION_BY_ICON: Partial<Record<IconName, IconMotion>> = {
  // Directional — the glyph moves the way the action moves.
  arrow: 'nudge-right', // ← ArrowRight
  'chevron-right': 'nudge-right', // ← ChevronRight
  play: 'nudge-right', // ← Play
  logOut: 'nudge-right', // ← Logout
  caret: 'nudge-down', // ← ChevronDown (BidStack's caret IS the down chevron)
  'chevron-down': 'nudge-down', // ← ChevronDown
  caretup: 'nudge-up', // ← ArrowUp
  download: 'bounce', // ← Download
  upload: 'nudge-up', // EXTRAPOLATED — Download's mirror; the source had no Upload
  link: 'launch', // ← Launch (the "leaves this app" verb)

  // Continuous — things that turn while they work.
  settings: 'spin', // ← Settings
  refresh: 'spin', // ← Renew / Restart
  clock: 'spin', // ← RecentlyViewed
  globe: 'spin', // ← Earth

  // Quarter-turn — add/dismiss pairs pivot into each other.
  plus: 'turn', // ← Add
  close: 'turn', // ← Close
  x: 'turn', // ← Close

  // Shake — destructive, protective, or "rummaging" actions.
  trash: 'wiggle', // ← TrashCan
  sliders: 'wiggle', // ← Tools
  wand: 'wiggle', // ← MagicWand
  search: 'wiggle', // ← Search
  warning: 'wiggle', // ← WarningAlt

  // Breathe — status and intelligence glyphs that report rather than act.
  info: 'pulse', // ← Information
  shield: 'pulse', // ← Security
  sparkle: 'pulse', // ← Ai
  zap: 'pulse', // ← Chip / Light

  // Pendulum.
  moon: 'swing', // ← Asleep
  bell: 'swing', // EXTRAPOLATED — a bell is the pendulum case the source lacked

  // `loader` is the one deliberate opt-OUT. Its call sites already spin it with
  // Tailwind's animate-spin; layering the hover keyframe on top restarts the
  // rotation mid-turn, which reads as a stutter exactly when the UI is meant to
  // look busy. "none" resolves --cds-hover to nothing and leaves it alone.
  loader: 'none',
};

/** The motion verb for an icon name. Unmapped names get "pop" (source default). */
export function iconMotionFor(name: IconName): IconMotion {
  return MOTION_BY_ICON[name] ?? 'pop';
}
