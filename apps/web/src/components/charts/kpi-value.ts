const compactExact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 2 });
const compactRounded = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

/** True when two fraction digits still name this unit count. Half a unit covers binary rounding. */
function compactKeepsUnits(units: number): boolean {
  const abs = Math.abs(units);
  for (const div of [1e9, 1e6, 1e3]) {
    if (abs < div) continue;
    for (let digits = 0; digits <= 2; digits += 1) {
      const rounded = Number((abs / div).toFixed(digits));
      if (Math.abs(rounded * div - abs) < 0.5) return true;
    }
    return false;
  }
  return false;
}

/**
 * Compact in en-GB when two fraction digits name the same units.
 * A count-up frame is not an integer, so it still compacts instead of printing
 * 5,063,132.1. A negative keeps its sign. An integer that is not exact stays
 * in full, which is how 12,015,000 avoids reading as 12m.
 */
export function formatKpiValue(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (compactKeepsUnits(n)) return compactExact.format(n);
  if (!Number.isSafeInteger(n)) return compactRounded.format(n);
  return n.toLocaleString('en-GB');
}

/** A count-up frame. Compact even when the eased amount is an inexact integer. */
export function formatKpiCountFrame(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (compactKeepsUnits(n)) return compactExact.format(n);
  return compactRounded.format(n);
}
