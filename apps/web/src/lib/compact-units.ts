/**
 * True when two fraction digits still name this unit count.
 * Half a unit covers binary rounding, so 2,010,000 stays 2.01 million.
 * 12,015,000 does not: two digits would move it by thousands.
 */
export function compactKeepsUnits(units: number): boolean {
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
