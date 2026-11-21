const DAY_MS = 86_400_000;

/**
 * Win rate for a closed book. Null when nothing has been decided, so an empty
 * quarter is not a 0% losing book. One win is 100. A closed-only book of
 * losses is 0. One decimal, half away from zero via Math.round.
 */
export function winRatePct(won: number, lost: number): number | null {
  const total = won + lost;
  if (total <= 0) return null;
  return Math.round((won / total) * 1000) / 10;
}

export interface PageRow {
  id: string;
}

/**
 * Read every page. The query guard allows `take` up to 1000 per call, so a
 * single findMany cannot be the total. A short page ends the read. A cursor
 * that does not advance ends it too, so a stuck page cannot loop.
 */
export async function readAllPages<T extends PageRow>(
  pageSize: number,
  fetchPage: (cursor: string | undefined) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    const next = page[page.length - 1]?.id;
    // A page that ends on the cursor we just sent did not advance.
    if (page.length === 0 || !next || next === cursor) return rows;
    rows.push(...page);
    if (page.length < pageSize) return rows;
    cursor = next;
  }
}

/**
 * Whole days from opening a bid to recording its outcome. Null when the
 * outcome predates the bid (history imported after the fact), so it never
 * shows up as a negative cycle.
 */
export function salesCycleDays(openedAt: Date, decidedAt: Date): number | null {
  const ms = decidedAt.getTime() - openedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / DAY_MS);
}
