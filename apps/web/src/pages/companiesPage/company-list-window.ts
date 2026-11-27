/**
 * The Companies list reads one page, newest first. "Showing latest 50
 * companies" is that window. The demo book is ten companies and the response
 * has no next page, so the sentence claims a window that is not there.
 *
 * Zero rows stay on the window sentence. An empty book already has its own
 * empty state, and this line is not that state.
 */
export function companyListIsWholeBook(count: number, hasNext: boolean): boolean {
  return count > 0 && !hasNext;
}
