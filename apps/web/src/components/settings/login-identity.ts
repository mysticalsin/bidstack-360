export type LoginAuthProvider = 'stub' | 'clerk' | 'demo' | 'cf-access';
export type LoginDataMode = 'demo' | 'real';

export type LoginDoor =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; dataMode: LoginDataMode; provider: LoginAuthProvider };

type LoginSource = {
  status: 'loading' | 'error' | 'ready';
  dataMode?: LoginDataMode | null;
  authProvider?: LoginAuthProvider | null;
};

/**
 * The login identity card names the door the identity answer reported.
 * Demo data is not a person, and a stub door is not Jane Smith. A load in
 * progress or a missing answer stays unlabeled.
 */
export function loginDoor(input: { publicId: LoginSource; me: LoginSource }): LoginDoor {
  if (input.publicId.status === 'loading' || input.me.status === 'loading') {
    return { state: 'loading' };
  }
  const dataMode = pickMode(input.publicId.dataMode) ?? pickMode(input.me.dataMode);
  const provider = pickProvider(input.publicId.authProvider) ?? pickProvider(input.me.authProvider);
  if (!dataMode || !provider) return { state: 'unavailable' };
  return { state: 'ready', dataMode, provider };
}

export const LOGIN_IDENTITY_CAPTION =
  'Who Polo thinks you are. Real mode uses your Cloudflare Access or Clerk email. Demo mode is synthetic records.';

export function loginProviderLabel(provider: LoginAuthProvider): string {
  switch (provider) {
    case 'demo':
      return 'Public demo door';
    case 'clerk':
      return 'Clerk';
    case 'cf-access':
      return 'Cloudflare Access';
    case 'stub':
      return 'Dev stub';
  }
}

export function loginDataModeLabel(mode: LoginDataMode): string {
  return mode === 'real' ? 'Real' : 'Demo';
}

/** Blank identity text stays blank in words. */
export function loginText(value: string | null | undefined, missing: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : missing;
}

export function loginRoleList(roles: readonly string[] | null | undefined, missing: string): string {
  const names = (roles ?? []).map((role) => role.trim()).filter((role) => role.length > 0);
  return names.length > 0 ? names.join(', ') : missing;
}

function pickMode(value: string | null | undefined): LoginDataMode | null {
  return value === 'demo' || value === 'real' ? value : null;
}

function pickProvider(value: string | null | undefined): LoginAuthProvider | null {
  return value === 'stub' || value === 'clerk' || value === 'demo' || value === 'cf-access'
    ? value
    : null;
}
