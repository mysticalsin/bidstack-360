// The sign-in card may say the box is unavailable only after a failed read.
// Until loaded is true, the session has not arrived.
// A loaded read with no failure is signed in or signed out.

export type CfAccessSignInPhase = 'unread' | 'failed' | 'signed-in' | 'signed-out';

export interface CfAccessSignInSnapshot {
  isLoaded: boolean;
  isSignedIn: boolean;
  hasFailure: boolean;
}

export function cfAccessSignInPhase(snapshot: CfAccessSignInSnapshot): CfAccessSignInPhase {
  if (!snapshot.isLoaded) return 'unread';
  if (snapshot.hasFailure) return 'failed';
  if (snapshot.isSignedIn) return 'signed-in';
  return 'signed-out';
}
