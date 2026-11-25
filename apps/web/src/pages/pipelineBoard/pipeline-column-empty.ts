/**
 * Copy for an empty deal-board column.
 *
 * Demo Lead holds no bids, and a finished page is the book, so the column is
 * empty. "Drop here" was the only sentence, including for a viewer who cannot
 * move a bid. A continued page has not loaded every bid, so an empty column
 * on that page is not an empty stage.
 */
export function pipelineColumnEmptyCopy(input: {
  canWrite: boolean;
  pageContinues: boolean;
}): { state: string; action: string | null } {
  return {
    state: input.pageContinues ? 'None in the latest bids' : 'No bids',
    action: input.canWrite ? 'Drop one here' : null,
  };
}
