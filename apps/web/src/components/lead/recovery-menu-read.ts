// The recovery menu may say the play list is empty only after the suggest
// arrives. A request still out has no plays yet. A rejection is not an
// empty list. A settled response with no plays is empty.

export type RecoveryMenuRequest = 'idle' | 'pending' | 'failed' | 'settled';

export type RecoveryMenuPhase = 'unread' | 'failed' | 'empty' | 'ready';

export function recoveryMenuPhase(input: {
  request: RecoveryMenuRequest;
  playCount: number;
}): RecoveryMenuPhase {
  if (input.request === 'failed') return 'failed';
  if (input.request !== 'settled') return 'unread';
  if (input.playCount === 0) return 'empty';
  return 'ready';
}

export function recoveryMenuUnreadMessage(): string {
  return 'Checking recovery plays. They have not arrived.';
}

export function recoveryMenuFailedMessage(): string {
  return 'Could not load recovery plays. The suggestions have not arrived.';
}
