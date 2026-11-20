function compactKeepsUnits(units: number): boolean {
  const abs = Math.abs(units);
  for (const div of [1e9, 1e6, 1e3]) {
    if (abs < div) continue;
    for (let digits = 0; digits <= 2; digits += 1) {
      if (Number((abs / div).toFixed(digits)) * div === abs) return true;
    }
    return false;
  }
  return false;
}

/** Compact in en-GB only when two fraction digits still name the same units. A negative keeps its sign. */
export function formatKpiValue(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (!Number.isSafeInteger(n)) return n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  if (!compactKeepsUnits(n)) return n.toLocaleString('en-GB');
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}
