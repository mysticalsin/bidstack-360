// The connection tester may offer an endpoint only after the setup contract
// arrives. A pause has isLoading false and no contract. That read is still
// unread. Error wins, then a missing contract is unread, else the tester is ready.

export type ConnectionTesterPhase = 'unread' | 'failed' | 'ready';

export interface ConnectionTesterSnapshot {
  guide?: unknown;
  isError?: boolean;
  status?: string;
}

export function connectionTesterPhase(snapshot: ConnectionTesterSnapshot): ConnectionTesterPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.guide === undefined || snapshot.guide === null) return 'unread';
  return 'ready';
}
