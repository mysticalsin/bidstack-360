import { describe, expect, it } from 'vitest';

import {
  formatMicrosAmount,
  microsToSafeNumber,
  microsToUnits,
  microsToUnitsText,
  sumMicros,
  unitsTextToMicros,
  unitsToMicros,
} from './money.js';

describe('microsToUnits', () => {
  it('converts everyday amounts exactly (bigint input)', () => {
    // WHY it matters: this is the common case (a single opportunity/forecast
    // row) — any drift here would misprice every deal card in the UI.
    expect(microsToUnits(1_500_000n)).toBe(1.5);
    expect(microsToUnits(0n)).toBe(0);
  });

  it('accepts number input (Prisma _sum can yield a plain 0, not 0n)', () => {
    // fetchAccountStats calls this as `microsToUnits(row._sum.valueMicros ?? 0)`
    // — the `?? 0` fallback is a `number`, so the util must accept the union.
    expect(microsToUnits(2_500_000)).toBe(2.5);
  });

  it('stays exact at magnitudes where naive Number(bigint)/1_000_000 corrupts the result', () => {
    // 2^53 + 2 micros ($9,007,199,254.740993) sits just past
    // Number.MAX_SAFE_INTEGER. Converting the whole BigInt to a Number
    // *before* dividing rounds it to the nearest even double first, so the
    // division "fixes" an already-wrong value. This is the exact bug this
    // module exists to kill — assert both halves so a regression that
    // reintroduces `Number(x) / 1e6` inside microsToUnits fails loudly.
    const micros = 9_007_199_254_740_993n;

    const naive = Number(micros) / 1_000_000;
    expect(naive).not.toBe(9_007_199_254.740993); // demonstrates the bug exists

    expect(microsToUnits(micros)).toBe(9_007_199_254.740993);
  });

  it('prints a large amount on the exact cent without a float', () => {
    expect(formatMicrosAmount(8_598_204_328_457_184_962n)).toBe('8,598,204,328,457.18');
    expect(formatMicrosAmount(2_500_000_000_000n)).toBe('2,500,000');
    expect(formatMicrosAmount(0n)).toBe('0');
  });

  it('round-trips a large amount through unit text without a float', () => {
    // WHY: the deal editor used to save Number(text) * 1e6 and drop this remainder.
    const micros = 8_598_204_328_457_184_962n;
    const text = microsToUnitsText(micros);
    expect(text).toBe('8598204328457.184962');
    expect(unitsTextToMicros(text)).toBe(micros);
    expect(unitsTextToMicros('8598204328457.18')).toBe(8_598_204_328_457_180_000n);
    expect(unitsTextToMicros('8,598,204,328,457.184962')).toBe(micros);
    expect(unitsTextToMicros('nope')).toBeNull();
  });

  it('stores a safe unit amount as integer micros without multiplying a float', () => {
    // WHY: Math.round(54_857_000_000 * 1e6) is not a safe integer, so the public
    // revenue claim was dropped instead of stored.
    expect(unitsToMicros(54_857_000_000)).toBe(54_857_000_000_000_000n);
    expect(unitsToMicros('+54857000000')).toBe(54_857_000_000_000_000n);
    expect(unitsToMicros('8598204328457.184962')).toBe(8_598_204_328_457_184_962n);
    expect(microsToSafeNumber(54_857_000_000_000_000n)).toBeNull();
    expect(microsToSafeNumber(1_200_000_000_000_000n)).toBe(1_200_000_000_000_000);
  });

  it('reconstructs negative amounts exactly, including the fractional remainder', () => {
    // Refunds/credits are stored as negative micros. BigInt division/modulo
    // truncate toward zero with a sign-matching remainder, so the
    // whole+remainder recombination must stay exact for negatives too — a
    // naive `Math.floor`-based split would double-count the sign.
    expect(microsToUnits(-1_500_000n)).toBe(-1.5);
    expect(microsToUnits(-1_234_567n)).toBeCloseTo(-1.234567, 9);
  });
});

describe('sumMicros', () => {
  it('accumulates without loss where a float reduce would silently drop precision', () => {
    // Three rows each 1 micro above the safe-integer boundary. A
    // `.reduce((a, b) => a + Number(b), 0)` (the pattern this replaces)
    // lands 3 short of the true total because each addend already lost its
    // low bit on conversion. BigInt accumulation must match the exact sum.
    const rowMicros = 9_007_199_254_740_993n;
    const values = [rowMicros, rowMicros, rowMicros];

    const naiveFloatSum = values.reduce((acc, v) => acc + Number(v), 0);
    expect(BigInt(naiveFloatSum)).not.toBe(rowMicros * 3n); // demonstrates the bug exists

    expect(sumMicros(values)).toBe(rowMicros * 3n);
  });

  it('treats null/undefined Prisma _sum results as zero instead of throwing', () => {
    expect(sumMicros([1_000_000n, null, undefined, 2_000_000n])).toBe(3_000_000n);
  });

  it('sums mixed positive and negative amounts (pipeline value net of refunds)', () => {
    expect(sumMicros([5_000_000n, -2_000_000n, -1_000_000n])).toBe(2_000_000n);
  });

  it('accepts mixed bigint/number entries', () => {
    expect(sumMicros([1_000_000n, 2_000_000, 500_000n])).toBe(3_500_000n);
  });

  it('returns 0n for an empty list (e.g. a company with no opportunities)', () => {
    expect(sumMicros([])).toBe(0n);
  });
});
