/**
 * Opportunity rows do not store a currency. A summed pipeline is not a euro
 * forecast, and converting it from a hardcoded EUR source would invent one.
 */
export const UNSPECIFIED_CURRENCY_BASIS = 'currency not recorded; not a euro forecast';

export function formatUnspecifiedAmount(value: number): string {
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  return amount;
}
