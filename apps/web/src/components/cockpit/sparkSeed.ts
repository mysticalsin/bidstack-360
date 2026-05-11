// Deterministic seed series helper, split from Sparkline.tsx so the
// component module exports only the component (fast-refresh requirement).

/**
 * Deterministic stand-in series for a KPI label. Until the backend ships
 * real trend data, the chart should still be present and *stable* — never
 * jittering between renders. Hashing the label gives the same shape for
 * the same KPI every time.
 */
export function seedSeries(label: string, length = 12): number[] {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    // Linear-congruential walk seeded from the hash. Values land in
    // [20, 100] which gives the sparkline visible peaks without clipping.
    h = Math.imul(h ^ i, 16777619);
    out.push(20 + (Math.abs(h) % 80));
  }
  return out;
}
