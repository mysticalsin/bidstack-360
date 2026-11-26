// The initiative board may say it is empty only after the list arrives.
// An idle or paused read has isLoading false and no payload. That read
// is still unread. A failure with no payload is not an empty board.
// A later failure keeps the cards already on screen.

export type KamInitiativeBoardPhase = 'unread' | 'failed' | 'ready';

export interface KamInitiativeBoardSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function kamInitiativeBoardPhase(
  snapshot: KamInitiativeBoardSnapshot,
): KamInitiativeBoardPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
