// Ported verbatim from D:\CRM\packages\ui\src\lib\dither.ts (12 lines).
// No token rewrites — the bloom classes take their colour from
// `--bloom-color` (defaulting to currentColor), so the glow always inherits
// whatever semantic token the caller already set on the element. No brand
// value crosses over.
//
// Class definitions live in apps/web/src/index.css ("Grafted rhythm" section).

export type Bloom = 'off' | 'low' | 'high' | 'aura';

const BLOOM_CLASS: Record<Bloom, string> = {
  off: '',
  low: 'bloom-low',
  high: 'bloom-high',
  aura: 'bloom-aura',
};

export function bloomClass(bloom: Bloom = 'off'): string {
  return BLOOM_CLASS[bloom];
}
