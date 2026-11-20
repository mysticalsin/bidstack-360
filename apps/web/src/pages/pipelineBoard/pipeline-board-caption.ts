/** Cards the pipeline board asks for. The list route reads one past this and drops it. */
export const PIPELINE_BOARD_LIMIT = 50;

/**
 * Count on a stage column. A continued page loaded `latest` bids, not every
 * bid. A page that fits keeps the card count. No stage total is invented.
 */
export function pipelineColumnCaption(
  count: number,
  pageContinues: boolean,
  latest: number,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every bid`;
  return String(count);
}

/**
 * Board status line. A continued page is the latest loaded bids, not every
 * opportunity. A shorter page keeps "N opportunities". No book total.
 */
export function pipelineBoardCaption(
  count: number,
  pageContinues: boolean,
  latest: number,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every bid`;
  return count === 1 ? `${count} opportunity` : `${count} opportunities`;
}
