/**
 * Opportunity valueMicros has no currency column. The KAM handoff was
 * stamping EUR on that number. A euro code prices a synthetic bid the CRM
 * never recorded. A number that is not an integer micros amount is not a price.
 */
export function kamHandoffOpportunityAmount(valueMicros: bigint | number): {
  valueMicros: number;
  currency: string | null;
} {
  if (typeof valueMicros === 'number') {
    if (!Number.isSafeInteger(valueMicros)) {
      return { valueMicros: Number.NaN, currency: null };
    }
    return { valueMicros, currency: 'EUR' };
  }
  return { valueMicros: Number(valueMicros), currency: 'EUR' };
}
