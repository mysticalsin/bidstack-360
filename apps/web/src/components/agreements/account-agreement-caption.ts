/** Agreements the account card counts. The route reads one past this page. */
export const ACCOUNT_AGREEMENTS_DRAWN = 500;

/**
 * Agreements counted on the card. The extra row only says another agreement
 * exists. It is not counted, and it is not a total.
 */
export function accountAgreementPage<T>(
  rows: readonly T[],
  drawn = ACCOUNT_AGREEMENTS_DRAWN,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Line under the active count. A longer loaded list is this page, not every
 * agreement on the account. A shorter list keeps "Active of N". No agreement
 * total is invented.
 */
export function accountAgreementCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) return `${count} in the latest ${count}, not every agreement`;
  return `Active of ${count}`;
}
