import { describe, expect, it } from 'vitest';

import { ssoSignInPolicy } from './sso-policy';

describe('ssoSignInPolicy', () => {
  it('keeps Microsoft as the official account and Google available when flags are unset', () => {
    // Why: the official release signs people in with Microsoft, and this
    // version must not drop Gmail just because nobody set a flag.
    expect(ssoSignInPolicy({})).toEqual({
      official: 'microsoft',
      microsoft: true,
      google: true,
    });
  });

  it('hides a provider only when that flag is exactly false', () => {
    expect(ssoSignInPolicy({ VITE_SSO_GOOGLE_ENABLED: 'false' }).google).toBe(false);
    expect(ssoSignInPolicy({ VITE_SSO_GOOGLE_ENABLED: 'false' }).microsoft).toBe(true);
    expect(ssoSignInPolicy({ VITE_SSO_MICROSOFT_ENABLED: 'false' }).microsoft).toBe(false);
    expect(ssoSignInPolicy({ VITE_SSO_MICROSOFT_ENABLED: 'false' }).google).toBe(true);
  });
});
