/**
 * Search results the page draws from one response. The query reads one past
 * each per-type limit, and one past the merged page, then drops those rows.
 */
export function searchResultsPage<T>(
  rows: readonly T[],
  drawn: number,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Count above the search results. A longer loaded list is this page, not
 * every match. A shorter list keeps "N results". No result total is invented.
 * `latest` is the number of rows the page drew before a tab filter.
 */
export function searchResultsCaption(
  count: number,
  pageContinues: boolean,
  latest: number,
): string {
  if (pageContinues) {
    return `${count} in the latest ${latest}, not every result`;
  }
  return count === 1 ? `${count} result` : `${count} results`;
}
