/** Calls the deal Calls tab draws. The list route reads one row past this page. */
export const OPPORTUNITY_CALLS_DRAWN = 25;

/**
 * Calls to draw. The extra row only says another call exists. It is not
 * shown, and it is not a total.
 */
export function opportunityCallPage<T>(
  rows: readonly T[],
  drawn = OPPORTUNITY_CALLS_DRAWN,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Calls the tab draws. The API drops the probe and sets `nextCursor`. A
 * response that still carries that row is paged here so the probe is not shown.
 */
export function shownOpportunityCalls<T>(
  items: readonly T[],
  callsContinue: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > OPPORTUNITY_CALLS_DRAWN) return opportunityCallPage(items);
  return { items: [...items], pageContinues: Boolean(callsContinue) };
}

/**
 * Deal call caption. A longer loaded list is the latest calls, not every
 * call on the deal. A shorter list keeps "{{count}} call". No call total
 * is invented.
 */
export function opportunityCallCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every call`;
  }
  return `${count} call`;
}
