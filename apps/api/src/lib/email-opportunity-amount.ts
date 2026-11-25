import { formatAmountFromMicros } from './email-token-amount.js';

export function emailOpportunityAmount(
  micros: bigint | number,
  country?: string | null,
): string {
  return formatAmountFromMicros(micros, inferCurrencyFromCountry(country));
}

/**
 * Best-effort currency inference from country code so the email-template
 * preview renders something reasonable without forcing a per-Opportunity
 * currency column. A future Sprint can swap to a real per-record currency.
 */
function inferCurrencyFromCountry(country: string | null | undefined): string {
  if (!country) return 'EUR';
  const c = country.toUpperCase();
  if (['US'].includes(c)) return 'USD';
  if (['GB'].includes(c)) return 'GBP';
  if (['CH'].includes(c)) return 'CHF';
  if (['JP'].includes(c)) return 'JPY';
  if (['AU'].includes(c)) return 'AUD';
  if (['CA'].includes(c)) return 'CAD';
  return 'EUR';
}
