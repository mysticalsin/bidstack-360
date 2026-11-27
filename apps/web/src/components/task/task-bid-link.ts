export type TaskBidLinkPhase = 'unread' | 'failed' | 'empty' | 'ready';

/**
 * The new-task dialog links a follow-up to a bid.
 * None is honest only after the bid book arrives with no rows.
 * A missing payload is still unread, including a pause where isLoading is false.
 * A failed read with no payload stays a failure.
 * A payload that is already in hand wins, so a later refresh does not hide the rows.
 */
export function taskBidLinkPhase(input: {
  isError: boolean;
  hasPayload: boolean;
  count: number;
}): TaskBidLinkPhase {
  if (input.hasPayload) return input.count === 0 ? 'empty' : 'ready';
  if (input.isError) return 'failed';
  return 'unread';
}

export function taskBidLinkMessage(phase: 'unread' | 'failed'): string {
  if (phase === 'unread') return 'Checking bids to link.';
  return 'Could not load bids to link. They have not arrived.';
}

export function taskBidLinkKey(phase: 'unread' | 'failed'): string {
  if (phase === 'unread') return 'createTask.bidsChecking';
  return 'createTask.bidsFailed';
}
