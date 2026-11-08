import { microsToSafeNumber } from '@bidstack/shared';

/** Legacy number plus the exact digit string. The number collapses past a safe integer. */
export function microsWireFields(micros: bigint): { valueMicros: number; valueMicrosText: string } {
  const value = micros > 0n ? micros : 0n;
  return {
    valueMicrosText: value.toString(),
    valueMicros: microsToSafeNumber(value) ?? Number(value),
  };
}
