import { randomBytes } from 'node:crypto';

import { _resetIntegrationTokenKey, encryptSecret } from '@bidstack/shared/server-crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  issueOAuthState,
  OAUTH_STATE_TTL_MS,
  OAuthStateError,
  openOAuthState,
} from './oauth-state.js';

let previousKey: string | undefined;

beforeAll(() => {
  previousKey = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString('hex');
  _resetIntegrationTokenKey();
});

afterAll(() => {
  if (previousKey === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = previousKey;
  _resetIntegrationTokenKey();
});

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof OAuthStateError) return err.reason;
    throw err;
  }
  return undefined;
}

const who = { orgId: 'org-a', userId: 'user-a' };

describe('oauth-state', () => {
  it('round-trips org, user and nonce for the same provider', () => {
    const { state, nonce } = issueOAuthState('gmail', who);
    expect(openOAuthState('gmail', state)).toEqual({ ...who, nonce });
    expect(state).not.toContain('org-a');
  });

  it('rejects a tampered state', () => {
    const { state } = issueOAuthState('gmail', who);
    const i = Math.floor(state.length / 2);
    const flipped = state.slice(0, i) + (state[i] === 'A' ? 'B' : 'A') + state.slice(i + 1);
    expect(reasonOf(() => openOAuthState('gmail', flipped))).toBe('invalid');
    expect(reasonOf(() => openOAuthState('gmail', 'not-a-state'))).toBe('invalid');
  });

  it('rejects an expired state', () => {
    const t0 = 1_700_000_000_000;
    const { state } = issueOAuthState('slack', who, t0);
    expect(openOAuthState('slack', state, t0 + OAUTH_STATE_TTL_MS).orgId).toBe('org-a');
    expect(reasonOf(() => openOAuthState('slack', state, t0 + OAUTH_STATE_TTL_MS + 1))).toBe(
      'expired',
    );
  });

  it('rejects a state minted for another provider', () => {
    const { state } = issueOAuthState('slack', who);
    expect(reasonOf(() => openOAuthState('gmail', state))).toBe('invalid');
  });

  it('rejects other encryptSecret blobs (purpose binding)', () => {
    const hubspotLike = encryptSecret(JSON.stringify({ orgId: 'org-a', userId: 'user-a', ts: 1 }));
    expect(reasonOf(() => openOAuthState('gmail', hubspotLike))).toBe('invalid');
  });
});
