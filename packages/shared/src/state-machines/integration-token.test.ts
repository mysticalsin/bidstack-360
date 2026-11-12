import { describe, expect, it } from 'vitest';

import { isIllegalTransition } from './illegal-transition.js';
import {
  TOKEN_EVENTS,
  TOKEN_STATES,
  tokenFrom,
  tokenRefreshAllowed,
  tokenTransition,
  type TokenEvent,
  type TokenState,
} from './integration-token.js';

const LEGAL: Array<[TokenState, TokenEvent, TokenState]> = [
  ['active', 'refresh_ok', 'active'],
  ['error', 'refresh_ok', 'active'],
  ['active', 'refresh_fail', 'error'],
  ['error', 'refresh_fail', 'error'],
  ['active', 'revoke', 'revoked'],
  ['error', 'revoke', 'revoked'],
];

describe('integration token transition table', () => {
  it('accepts every legal row and uses that from-list', () => {
    for (const [from, event, to] of LEGAL) {
      expect(tokenTransition(from, event)).toBe(to);
      expect(tokenFrom(event)).toContain(from);
    }
  });

  it('rejects the full illegal cross product', () => {
    const legal = new Set(LEGAL.map(([from, event]) => `${from}|${event}`));
    for (const from of TOKEN_STATES) {
      for (const event of TOKEN_EVENTS) {
        if (legal.has(`${from}|${event}`)) continue;
        expect(isIllegalTransition(tokenTransition(from, event))).toBe(true);
        expect(tokenFrom(event)).not.toContain(from);
      }
    }
  });

  it('refuses a refresh from expired, and expired has no writer', () => {
    for (const event of TOKEN_EVENTS) {
      expect(isIllegalTransition(tokenTransition('expired', event))).toBe(true);
      expect(tokenFrom(event)).not.toContain('expired');
    }
  });

  it('allows a refresh only while the grant is not deleted', () => {
    expect(tokenRefreshAllowed(null)).toBe(true);
    expect(tokenRefreshAllowed(new Date('2026-11-11T12:00:00.000Z'))).toBe(false);
  });
});
