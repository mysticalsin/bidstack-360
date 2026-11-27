/** Sample rows never ran the MSA leverage read. */
export const SAMPLE_LEVERAGE_UNREAD =
  'This Sample preview has not loaded MSA leverage flags.';

/** Later agreements on a continuing page are not in this result. */
export const PAGE_LEVERAGE_UNREAD =
  'Under-leveraged MSAs past this page have not loaded.';

/**
 * Sentence to show instead of a zero when the Under-leveraged filter has
 * no row yet. Null means the library may keep its settled empty copy:
 * the read finished, the page does not continue, and nothing matched.
 */
export function leverageFilterHold(input: {
  leverageOn: boolean;
  matchCount: number;
  pageContinues: boolean;
  sample: boolean;
}): string | null {
  if (!input.leverageOn || input.matchCount > 0) return null;
  if (input.sample) return SAMPLE_LEVERAGE_UNREAD;
  if (input.pageContinues) return PAGE_LEVERAGE_UNREAD;
  return null;
}
