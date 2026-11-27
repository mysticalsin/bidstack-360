// Columns and detail shape for contract_agreements.liability_cap_*.
// Confirm stores an extracted cap that never passed MsaLiabilityCap.
// BigInt accepts a negative and an over-max integer, and throws on a euro
// symbol. Postgres int8 overflow and the detail serializer then answer 500.
// Refuse those writes with 400. A cap already stored in that shape is
// omitted so the agreement page still loads.

import { MsaLiabilityCap } from '@bidstack/shared';

const CURRENCY_CODE = /^[A-Z]{3}$/;

function refuseCap(): never {
  const err = new Error('Liability cap must be a non-negative micros amount in a 3-letter currency');
  (err as unknown as { statusCode: number }).statusCode = 400;
  throw err;
}

export function liabilityFields(cap: unknown): {
  liabilityCapMicros?: bigint | null;
  liabilityCapCurrency?: string | null;
} {
  if (cap === undefined) return {};
  if (cap === null) return { liabilityCapMicros: null, liabilityCapCurrency: null };
  const parsed = MsaLiabilityCap.safeParse(cap);
  // "€UR" is three characters and would pass the schema's length check.
  if (!parsed.success || !CURRENCY_CODE.test(parsed.data.currency)) refuseCap();
  return {
    liabilityCapMicros: BigInt(parsed.data.amountMicros),
    liabilityCapCurrency: parsed.data.currency,
  };
}

export function liabilityCapForRead(
  micros: bigint | null,
  currency: string | null,
): { amountMicros: number; currency: string } | null {
  if (micros === null || !currency) return null;
  const parsed = MsaLiabilityCap.safeParse({ amountMicros: Number(micros), currency });
  if (!parsed.success || !CURRENCY_CODE.test(parsed.data.currency)) return null;
  // Number() can round a bigint that is past the safe integer max. Do not
  // send that rounded amount as if it were the stored cap.
  if (BigInt(parsed.data.amountMicros) !== micros) return null;
  return parsed.data;
}
