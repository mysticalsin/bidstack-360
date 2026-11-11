import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const TOKEN_STATES = ['active', 'expired', 'revoked', 'error'] as const;
export type TokenState = (typeof TOKEN_STATES)[number];

export const TOKEN_EVENTS = ['refresh_ok', 'refresh_fail', 'revoke'] as const;
export type TokenEvent = (typeof TOKEN_EVENTS)[number];

const FROM: Record<TokenEvent, readonly TokenState[]> = {
  refresh_ok: ['active', 'error'],
  refresh_fail: ['active', 'error'],
  revoke: ['active', 'error'],
};

const TO: Record<TokenEvent, TokenState> = {
  refresh_ok: 'active',
  refresh_fail: 'error',
  revoke: 'revoked',
};

/** Statuses a refresh or revoke may match. `expired` has no writer. `revoked` is not rewritten. */
export function tokenFrom(event: TokenEvent): readonly TokenState[] {
  return FROM[event];
}

export function tokenTransition(from: TokenState, event: TokenEvent): TokenState | IllegalTransition {
  if (!FROM[event].includes(from)) return illegalTransition();
  return TO[event];
}

/** A tombstone is not a refresh source. */
export function tokenRefreshAllowed(deletedAt: Date | null): boolean {
  return deletedAt === null;
}

/**
 * An unknown stored value is viewed as revoked and is not a known state.
 * Callers do not write that view back and do not refresh the grant.
 */
export function tokenStateFromStored(value: string): { state: TokenState; known: boolean } {
  if ((TOKEN_STATES as readonly string[]).includes(value)) {
    return { state: value as TokenState, known: true };
  }
  return { state: 'revoked', known: false };
}
