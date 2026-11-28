/**
 * The tasks header names how many follow-ups are still open in the book.
 * The list on screen is one page and includes completed rows, so its length
 * is not that number. A summary that has not arrived is not an empty book.
 */
export function activeFollowUpCount(summary: {
  isLoading: boolean;
  isError: boolean;
  data?: { open: number } | null;
}): { phase: 'pending' } | { phase: 'error' } | { phase: 'ready'; active: number } {
  const open = summary.data?.open;
  if (typeof open === 'number' && Number.isFinite(open)) {
    return { phase: 'ready', active: Math.max(0, open) };
  }
  if (summary.isError) return { phase: 'error' };
  return { phase: 'pending' };
}
