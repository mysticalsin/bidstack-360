import { emailTokenAmount } from './email-token-amount.js';

/** Exact units. The column has no currency, so the token does not name EUR. */
export function emailOpportunityAmount(micros: bigint | number): string {
  return emailTokenAmount(micros);
}
