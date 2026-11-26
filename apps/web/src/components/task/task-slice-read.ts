export type TaskSlice = 'recent' | 'list';

export type TaskSliceRead =
  | { phase: 'unread' }
  | { phase: 'failed' }
  | { phase: 'empty' }
  | { phase: 'ready'; count: number };

/**
 * Recent is the default tasks order. List is every other sort.
 * A count of zero is an empty book only after a payload arrives.
 * Pending and failed reads have no rows yet, even when a caller passes 0.
 */
export function taskSliceRead(input: {
  isPending: boolean;
  isError: boolean;
  count: number | null;
}): TaskSliceRead {
  if (input.isError) return { phase: 'failed' };
  if (input.isPending || input.count === null) return { phase: 'unread' };
  if (input.count === 0) return { phase: 'empty' };
  return { phase: 'ready', count: input.count };
}

export function taskSliceReadMessage(slice: TaskSlice, phase: 'unread' | 'failed'): string {
  if (slice === 'recent' && phase === 'unread') return 'Checking recent follow-ups.';
  if (slice === 'recent' && phase === 'failed') {
    return 'Could not load recent follow-ups. They have not arrived.';
  }
  if (phase === 'unread') return 'Checking follow-ups.';
  return 'Could not load follow-ups. They have not arrived.';
}

export function taskSliceReadKey(slice: TaskSlice, phase: 'unread' | 'failed'): string {
  if (slice === 'recent' && phase === 'unread') return 'tasks.read.recentChecking';
  if (slice === 'recent' && phase === 'failed') return 'tasks.read.recentFailed';
  if (phase === 'unread') return 'tasks.read.checking';
  return 'tasks.read.failed';
}
