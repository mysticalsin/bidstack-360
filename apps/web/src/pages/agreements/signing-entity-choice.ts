// The review may offer Not confirmed only after the signing-entity catalog arrives.
// A pause has isLoading false and no list. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type SigningEntityChoicePhase = 'unread' | 'failed' | 'ready';

export interface SigningEntityChoiceSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function signingEntityChoicePhase(snapshot: SigningEntityChoiceSnapshot): SigningEntityChoicePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
