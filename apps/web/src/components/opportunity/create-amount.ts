import { unitsTextToMicros } from '@bidstack/shared';

/** Create payload for a typed amount. A large figure travels as micros, not as a rounded number. */
export function createAmountPayload(
  text: string,
): { value: number; valueMicros: string } | null {
  const micros = unitsTextToMicros(text);
  if (micros == null) return null;
  const asNumber = Number(text.trim().replace(/,/g, ''));
  const product = asNumber * 1_000_000;
  const safe =
    Number.isFinite(product) &&
    asNumber >= 0 &&
    asNumber <= 1_000_000_000_000 &&
    Number.isSafeInteger(Math.round(product)) &&
    BigInt(Math.round(product)) === micros;
  return { value: safe ? asNumber : 0, valueMicros: micros.toString() };
}
