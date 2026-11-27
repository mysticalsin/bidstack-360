export type ProfileAuthProvider = 'stub' | 'clerk' | 'demo' | 'cf-access';

export type ProfileAuthLabel =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; kind: ProfileAuthProvider };

/**
 * The profile card names the door the identity answer reported.
 * A load in progress, a failed load, or a ready payload with no provider
 * stays unlabeled. A build-time Clerk key is not an answer, so it cannot
 * turn a demo session into Clerk or fill a gap with the dev stub.
 */
export function profileAuthLabel(input: {
  status: 'loading' | 'error' | 'ready';
  authProvider?: ProfileAuthProvider | null;
}): ProfileAuthLabel {
  if (input.status === 'loading') return { state: 'loading' };
  if (input.status === 'error') return { state: 'error' };
  if (
    input.authProvider === 'demo' ||
    input.authProvider === 'clerk' ||
    input.authProvider === 'cf-access' ||
    input.authProvider === 'stub'
  ) {
    return { state: 'ready', kind: input.authProvider };
  }
  return { state: 'error' };
}
