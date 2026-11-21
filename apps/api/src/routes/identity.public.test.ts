import { describe, expect, it } from 'vitest';

import { publicIdentityPayload } from './identity.js';

describe('public identity', () => {
  it('returns only the fields the web reads', () => {
    const payload = publicIdentityPayload({
      processData: 'real',
      effectiveData: 'real',
      auth: 'cf-access',
      deployment: 'production',
      publicDemoDoor: false,
      stubBanner: null,
    });
    expect(Object.keys(payload).sort()).toEqual(
      ['auth', 'authProvider', 'dataMode', 'publicDemoDoor', 'stubBanner'].sort(),
    );
    expect(payload).not.toHaveProperty('providers');
    expect(payload).not.toHaveProperty('allowlist');
    expect(payload).not.toHaveProperty('processData');
  });
});
