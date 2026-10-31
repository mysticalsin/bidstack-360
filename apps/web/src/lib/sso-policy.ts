// Official identity is a Microsoft account. Google sign-in, including Gmail,
// stays available in this version until it is explicitly turned off.
// Unset means shown. Only the string "false" hides a provider.

export interface SsoEnv {
  VITE_SSO_MICROSOFT_ENABLED?: string;
  VITE_SSO_GOOGLE_ENABLED?: string;
}

export interface SsoSignInPolicy {
  official: 'microsoft';
  microsoft: boolean;
  google: boolean;
}

export function ssoSignInPolicy(env: SsoEnv = import.meta.env): SsoSignInPolicy {
  return {
    official: 'microsoft',
    microsoft: env.VITE_SSO_MICROSOFT_ENABLED !== 'false',
    google: env.VITE_SSO_GOOGLE_ENABLED !== 'false',
  };
}
