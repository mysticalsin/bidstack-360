export type ContactDuplicateRead =
  | { phase: 'unread' }
  | { phase: 'failed' }
  | { phase: 'empty' }
  | { phase: 'ready' };

/**
 * A clean contact book is zero clusters only after a payload arrives.
 * Pending and failed reads have no clusters yet, even when a caller passes [].
 */
export function contactDuplicateRead(input: {
  isPending: boolean;
  isError: boolean;
  clusters: readonly unknown[] | null;
}): ContactDuplicateRead {
  if (input.isError) return { phase: 'failed' };
  if (input.isPending || input.clusters === null) return { phase: 'unread' };
  if (input.clusters.length === 0) return { phase: 'empty' };
  return { phase: 'ready' };
}

export function contactDuplicateUnreadMessage(): string {
  return 'Checking duplicate contacts. They have not arrived.';
}

export function contactDuplicateFailedMessage(): string {
  return 'The contact duplicates have not arrived.';
}
