// Accent color system for the marketing site. Mirrors apps/web's accent lib
// (and shares the `polo-accent` localStorage key) so a visitor's accent choice
// follows them into the app, just like the shared `bidstack-theme` key. Base
// tokens in index.css are never edited — accents are inline :root overrides,
// and "Default" simply clears them.

export type AccentId = 'default' | 'violet' | 'emerald' | 'rose' | 'amber' | 'sky';

interface AccentDef {
  id: AccentId;
  label: string;
  swatch: string;
  light: string | null;
  dark: string | null;
}

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

// Only the tokens the marketing site actually defines (index.css). --color-brand*
// alias to these via var(), so they follow automatically.
function tokens(p: string, dark: boolean): Record<string, string> {
  return {
    '--brand-primary': p,
    '--brand-primary-hover': dark ? lighten(p, 0.12) : darken(p, 0.1),
    '--brand-primary-press': dark ? darken(p, 0.1) : darken(p, 0.22),
    '--brand-primary-tint': dark ? rgba(p, 0.18) : lighten(p, 0.92),
    '--brand-deep': dark ? lighten(p, 0.12) : darken(p, 0.38),
    '--border-focus': p,
    '--focus-ring': `0 0 0 3px ${rgba(p, dark ? 0.22 : 0.14)}`,
    '--focus-ring-color': rgba(p, dark ? 0.45 : 0.35),
    '--brand-gradient': `linear-gradient(135deg, ${p} 0%, ${lighten(p, dark ? 0.22 : 0.28)} 100%)`,
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

export function reapplyAccent(): void {
  applyAccent(getStoredAccent());
}

export function initAccent(): void {
  applyAccent(getStoredAccent());
}
