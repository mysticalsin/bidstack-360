/**
 * Opportunity valueMicros has no currency column. The KAM handoff must not
 * stamp EUR on that number. A euro code would price a synthetic bid the CRM
 * never recorded. A number that is not an integer micros amount is not a price.
 */
export function kamHandoffOpportunityAmount(valueMicros: bigint | number): {
  valueMicros: number;
  currency: null;
} {
  if (typeof valueMicros === 'number') {
    if (!Number.isSafeInteger(valueMicros)) {
      return { valueMicros: Number.NaN, currency: null };
    }
    return { valueMicros, currency: null };
  }
  return { valueMicros: Number(valueMicros), currency: null };
}
