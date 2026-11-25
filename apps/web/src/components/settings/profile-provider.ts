export type PoloAuthProvider = 'stub' | 'clerk' | 'demo' | 'cf-access';

export type ProfileProviderView =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; provider: PoloAuthProvider };

/**
 * The profile card names the door the server reported.
 * A missing answer stays missing. Demo is not a dev stub, and a Clerk
 * publishable key in the bundle does not change that answer.
 */
export function profileAuthProvider(input: {
  status: 'loading' | 'error' | 'ready';
  authProvider?: PoloAuthProvider | null;
}): ProfileProviderView {
  if (input.status === 'loading') return { state: 'loading' };
  if (input.status !== 'ready') return { state: 'unavailable' };
  switch (input.authProvider) {
    case 'demo':
    case 'cf-access':
    case 'clerk':
    case 'stub':
      return { state: 'ready', provider: input.authProvider };
    default:
      return { state: 'unavailable' };
  }
}

/** Blank profile text stays blank in words. Signed out is not an empty file. */
export function profileIdentityLine(input: {
  signedIn: boolean;
  value: string | null | undefined;
  missing: string;
  signedOut: string;
}): string {
  const trimmed = typeof input.value === 'string' ? input.value.trim() : '';
  if (trimmed.length > 0) return trimmed;
  return input.signedIn ? input.missing : input.signedOut;
}

export function profileDisplayName(input: {
  signedIn: boolean;
  fullName: string | null | undefined;
  firstName: string | null | undefined;
  email: string | null | undefined;
  signedInFallback: string;
  guest: string;
}): string {
  if (!input.signedIn) return input.guest;
  for (const value of [input.fullName, input.firstName, input.email]) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed.length > 0) return trimmed;
  }
  return input.signedInFallback;
}

/**
 * Demo auth keeps reporting admin after sign-out. The profile shows a role
 * only while the person is signed in.
 */
export function profileRole(signedIn: boolean, role: string | null | undefined): string | null {
  if (!signedIn) return null;
  const trimmed = typeof role === 'string' ? role.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}
