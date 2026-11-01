import { describe, expect, it } from 'vitest';

import {
  canonicalDustWorkspaceId,
  dustCredentialsFromEnv,
} from './dust-credentials.js';

describe('Dust workspace id', () => {
  // WHY: docs.dust.tt identifies the workspace by the URL segment, not the
  // name shown in the workspace switcher. Sending a display name 404s every call.
  it('keeps the id from the workspace URL and rejects a display name', () => {
    expect(canonicalDustWorkspaceId('https://dust.tt/w/abc123')).toBe('abc123');
    expect(canonicalDustWorkspaceId('https://eu.dust.tt/w/abc123/')).toBe('abc123');
    expect(canonicalDustWorkspaceId('Mantu Presales')).toBeNull();
    expect(canonicalDustWorkspaceId('abc123')).toBe('abc123');
  });

  it('does not treat a display name as a configured workspace', () => {
    expect(
      dustCredentialsFromEnv({
        DUST_API_KEY: 'sk-test-key',
        DUST_WORKSPACE_ID: 'Mantu Presales',
        DUST_SPACE_ID: 'space-1',
      }),
    ).toBeNull();
  });

  it('reads the space id and EU base separately from the workspace id', () => {
    expect(
      dustCredentialsFromEnv({
        DUST_API_KEY: 'sk-test-key',
        DUST_WORKSPACE_ID: 'abc123',
        DUST_SPACE_ID: 'space-1',
        DUST_BASE_URL: 'https://eu.dust.tt/api',
      }),
    ).toMatchObject({
      workspaceId: 'abc123',
      spaceId: 'space-1',
      baseUrl: 'https://eu.dust.tt/api',
    });
  });

  it('drops a space display name so document calls are not built from it', () => {
    expect(
      dustCredentialsFromEnv({
        DUST_API_KEY: 'sk-test-key',
        DUST_WORKSPACE_ID: 'abc123',
        DUST_SPACE_ID: 'Company Data',
      })?.spaceId,
    ).toBeUndefined();
  });
});
