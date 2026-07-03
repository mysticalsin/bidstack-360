// Accent color system. Users pick a brand accent in Settings; we override the
// `--brand-primary` token chain as inline styles on <html>. Base tokens in
// index.css are never touched, so "Default" is simply "no overrides" and the
// original blue theme is always the fallback. Values are derived from a single
// primary hex per (accent, theme) so the whole chain stays in sync.

export type AccentId = 'default' | 'violet' | 'emerald' | 'rose' | 'amber' | 'sky';

interface AccentDef {
  id: AccentId;
  /** i18n-independent English label + swatch color for the picker. */
  label: string;
  swatch: string;
  /** Primary hex per theme. `default` is null → clears overrides. */
  light: string | null;
  dark: string | null;
}

// Primaries verified for WCAG AA: white-on-primary (buttons) and, in light,
// primary-on-white (text) both clear 4.5:1; dark buttons clear the app's
// existing 4.70:1 baseline. See scratchpad/brand/contrast.mjs.
export const ACCENTS: AccentDef[] = [
  { id: 'default', label: 'Default', swatch: '#2c4bff', light: null, dark: null },
  { id: 'violet', label: 'Polo Violet', swatch: '#4a17f0', light: '#4a17f0', dark: '#6a48e6' },
  { id: 'emerald', label: 'Emerald', swatch: '#047857', light: '#047857', dark: '#0a7d57' },
  { id: 'rose', label: 'Rose', swatch: '#be123c', light: '#be123c', dark: '#e11d48' },
  { id: 'amber', label: 'Amber', swatch: '#b45309', light: '#b45309', dark: '#b45309' },
  { id: 'sky', label: 'Sky', swatch: '#0369a1', light: '#0369a1', dark: '#0369a1' },
];

export const ACCENT_STORAGE_KEY = 'polo-accent';
const VALID = new Set(ACCENTS.map((a) => a.id));

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function toHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
function mix(hex: string, target: [number, number, number], amt: number): string {
  const [r, g, b] = toRgb(hex);
  return toHex([r + (target[0] - r) * amt, g + (target[1] - g) * amt, b + (target[2] - b) * amt]);
}
const darken = (hex: string, a: number) => mix(hex, [0, 0, 0], a);
const lighten = (hex: string, a: number) => mix(hex, [255, 255, 255], a);
const rgba = (hex: string, a: number) => {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// The full brand-token chain, derived from one primary. Mirrors the light/dark
// token relationships already used in index.css so switching accents preserves
// the same hover/press/tint/glow rhythm.
function tokens(p: string, dark: boolean): Record<string, string> {
  const hover = dark ? lighten(p, 0.12) : darken(p, 0.1);
  const tint = dark ? rgba(p, 0.18) : lighten(p, 0.92);
  const deep = dark ? lighten(p, 0.12) : darken(p, 0.38);
  return {
    '--brand-primary': p,
    '--brand-primary-hover': hover,
    '--brand-primary-press': dark ? darken(p, 0.1) : darken(p, 0.22),
    '--brand-primary-tint': tint,
    '--brand-deep': deep,
    '--brand': p,
    '--brand-hover': hover,
    '--brand-muted': tint,
    '--accent-primary': p,
    '--border-focus': p,
    '--sidebar-badge-fg': dark ? lighten(p, 0.1) : p,
    '--sidebar-badge-bg': rgba(p, dark ? 0.18 : 0.1),
    '--sidebar-active': rgba(p, dark ? 0.18 : 0.08),
    '--ring': rgba(p, dark ? 0.45 : 0.35),
    '--focus-ring': `0 0 0 3px ${rgba(p, dark ? 0.22 : 0.14)}`,
    '--focus-ring-color': rgba(p, dark ? 0.45 : 0.35),
    '--border-glow': rgba(p, dark ? 0.15 : 0.08),
    '--border-glow-strong': rgba(p, dark ? 0.3 : 0.16),
    '--brand-gradient-start': p,
    '--brand-gradient-end': dark ? lighten(p, 0.2) : darken(p, 0.15),
    '--brand-gradient': `linear-gradient(135deg, ${p} 0%, ${dark ? lighten(p, 0.2) : darken(p, 0.15)} 100%)`,
  };
}

const TOKEN_KEYS = Object.keys(tokens('#000000', false));

export function getStoredAccent(): AccentId {
  try {
    const v = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (v && VALID.has(v as AccentId)) return v as AccentId;
  } catch {
    /* ignore */
  }
  return 'default';
}

// Apply an accent for the *current* theme. Reads the theme from <html> so it
// stays correct across theme toggles; call again after a theme change.
export function applyAccent(id: AccentId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const def = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]!;
  const isDark = root.dataset.theme === 'dark';
  const primary = isDark ? def.dark : def.light;
  root.dataset.accent = id;
  if (!primary) {
    for (const k of TOKEN_KEYS) root.style.removeProperty(k);
    return;
  }
  const map = tokens(primary, isDark);
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
}

/** Re-apply the persisted accent (used after a light/dark toggle). */
export function reapplyAccent(): void {
  applyAccent(getStoredAccent());
}

/** Boot the persisted accent before first render. */
export function initAccent(): void {
  applyAccent(getStoredAccent());
}
