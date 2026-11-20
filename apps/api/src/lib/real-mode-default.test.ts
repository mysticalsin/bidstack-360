import { describe, expect, it } from 'vitest';

import { assertPoloAuthBoot, getPoloDataMode } from './polo-mode.js';

describe('real mode is the default', () => {
  it('treats an unset or blank POLO_DATA_MODE as real, and demo only when it is exactly demo', () => {
    // WHY: Tony asked for a real workspace unless someone opts into fixtures.
    // Anything other than the exact word demo, including a missing variable,
    // has to be real. The old helper treated every other value as demo.
    expect(getPoloDataMode({})).toBe('real');
    expect(getPoloDataMode({ POLO_DATA_MODE: '' })).toBe('real');
    expect(getPoloDataMode({ POLO_DATA_MODE: 'REAL' })).toBe('real');
    expect(getPoloDataMode({ POLO_DATA_MODE: 'demo' })).toBe('demo');
  });

  it('lets development boot in real mode without a new identity provider', () => {
    // WHY: a fresh checkout has no Clerk key and no Cloudflare Access tenant.
    // Real mode still has to start so the operator can sign in with the
    // existing development stub and type their own records. Production keeps
    // the identity requirement.
    expect(() =>
      assertPoloAuthBoot({ POLO_DATA_MODE: 'real', NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() => assertPoloAuthBoot({ NODE_ENV: 'development' })).not.toThrow();
    expect(() =>
      assertPoloAuthBoot({ POLO_DATA_MODE: 'real', NODE_ENV: 'production' }),
    ).toThrow(/CLERK_SECRET_KEY|CF_ACCESS_AUTH/);
  });
});
