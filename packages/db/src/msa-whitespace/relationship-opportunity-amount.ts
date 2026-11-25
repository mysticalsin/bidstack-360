/**
 * Opportunity valueMicros has no currency column. The relationship map was
 * stamping EUR on that number. A euro code prices a synthetic bid the CRM
 * never recorded. A number that is not an integer micros amount is not a price.
 */
export function relationshipOpportunityAmount(valueMicros: bigint | number | null | undefined): {
  valueMicros: number | null;
  currency: string | null;
} {
  if (valueMicros === null || valueMicros === undefined) {
    return { valueMicros: null, currency: null };
  }
  if (typeof valueMicros === 'number') {
    if (!Number.isSafeInteger(valueMicros)) {
      return { valueMicros: null, currency: null };
    }
    return { valueMicros, currency: 'EUR' };
  }
  if (valueMicros > BigInt(Number.MAX_SAFE_INTEGER) || valueMicros < BigInt(Number.MIN_SAFE_INTEGER)) {
    return { valueMicros: null, currency: null };
  }
  return { valueMicros: Number(valueMicros), currency: 'EUR' };
}
