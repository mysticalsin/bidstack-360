// The presence stack hides the signed-in person by this id. A bad token
// must yield nothing, or a corrupt localStorage value would throw while
// a bid page is opening and blank the whole header.
import { describe, expect, it } from 'vitest';

import { DEMO_TOKEN_KEY } from './auth';
import { DEMO_SESSION_TOKEN_KEY, demoSessionUserId } from './demo-session-user';

const USER_ID = '33333333-3333-4333-8333-333333333333';

function token(userId: string): string {
  const json = JSON.stringify({
    u: userId,
    o: '22222222-2222-4222-8222-222222222222',
    exp: 4_000_000_000,
  });
  const body = btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
  return `demo_${body}.not-a-signature`;
}

describe('demoSessionUserId', () => {
  it('uses the same storage key the demo sign-in writes', () => {
    // WHY: presence reads the token without importing auth (that module is
    // mocked in presence tests). If these keys drift, the filter looks at
    // an empty slot and the signed-in person shows up as a teammate again.
    expect(DEMO_SESSION_TOKEN_KEY).toBe(DEMO_TOKEN_KEY);
    expect(DEMO_SESSION_TOKEN_KEY).toBe('bidstack:demo-token');
  });

  it('returns the user id carried in a demo session token', () => {
    expect(demoSessionUserId(token(USER_ID))).toBe(USER_ID);
  });

  it('returns null for a missing, unsigned, or non-uuid payload', () => {
    expect(demoSessionUserId(null)).toBeNull();
    expect(demoSessionUserId('demo-token-abc')).toBeNull();
    expect(demoSessionUserId(token('demo-user'))).toBeNull();
    expect(demoSessionUserId('demo_%%% .sig')).toBeNull();
  });
});
