/** Agreements the library table draws. The list reads one past this page. */
export const AGREEMENTS_LIST_DRAWN = 100;

/**
 * Agreements drawn on /agreements. The extra row only says another agreement
 * exists. It is not drawn, and it is not a total.
 */
export function agreementsListPage<T>(
  rows: readonly T[],
  drawn = AGREEMENTS_LIST_DRAWN,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Count under the agreements table. A longer loaded list is this page, not
 * every agreement. A shorter list keeps "N agreements" (and " match" when a
 * filter is on). No agreement total is invented.
 */
export function agreementsListCaption(
  count: number,
  pageContinues: boolean,
  opts: { filtered: boolean; nestedNote: boolean },
): string {
  const nested = opts.nestedNote ? ' · SOWs and amendments sit under their parent' : '';
  if (pageContinues) {
    const page = opts.filtered
      ? `${count} ${count === 1 ? 'match' : 'matches'} in the latest ${AGREEMENTS_LIST_DRAWN}, not every agreement`
      : `${count} in the latest ${AGREEMENTS_LIST_DRAWN}, not every agreement`;
    return `${page}${nested}`;
  }
  const noun = count === 1 ? 'agreement' : 'agreements';
  return `${count} ${noun}${opts.filtered ? ' match' : ''}${nested}`;
}
