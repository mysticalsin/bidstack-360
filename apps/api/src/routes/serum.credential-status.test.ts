import { describe, expect, it } from 'vitest';

import { credentialSignalStatus } from './serum.js';

describe('credentialSignalStatus', () => {
  it('does not call a saved key a live ready connection', () => {
    expect(credentialSignalStatus(true)).toBe('attention');
    expect(credentialSignalStatus(false)).toBe('not_configured');
  });
});
