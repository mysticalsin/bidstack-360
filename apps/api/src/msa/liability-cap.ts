// Columns and detail shape for contract_agreements.liability_cap_*.
// Confirm copies an extracted cap with BigInt. Detail then serializes it
// through MsaLiabilityCap. A value that fails that schema is a 500.

export function liabilityFields(cap: unknown): {
  liabilityCapMicros?: bigint | null;
  liabilityCapCurrency?: string | null;
} {
  if (cap === undefined) return {};
  if (cap === null) return { liabilityCapMicros: null, liabilityCapCurrency: null };
  const value = cap as { amountMicros: number; currency: string };
  return { liabilityCapMicros: BigInt(value.amountMicros), liabilityCapCurrency: value.currency };
}

export function liabilityCapForRead(
  micros: bigint | null,
  currency: string | null,
): { amountMicros: number; currency: string } | null {
  if (micros === null || !currency) return null;
  return { amountMicros: Number(micros), currency };
}
