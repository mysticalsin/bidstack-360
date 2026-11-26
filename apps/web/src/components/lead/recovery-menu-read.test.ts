import { describe, expect, it } from 'vitest';

import {
  recoveryMenuFailedMessage,
  recoveryMenuPhase,
  recoveryMenuUnreadMessage,
} from './recovery-menu-read';

// A missing suggest is not an empty play list.
const NOT_A_SETTLED_ANSWER = /\b(0|zero|empty|none|ready)\b/i;

describe('recoveryMenuPhase', () => {
  it('does not treat a suggest still out as an empty play list', () => {
    // Opening the menu has no plays yet. That is not "no suggestions."
    expect(recoveryMenuPhase({ request: 'pending', playCount: 0 })).toBe('unread');
    expect(recoveryMenuPhase({ request: 'idle', playCount: 0 })).toBe('unread');
    expect(recoveryMenuUnreadMessage()).toBe('Checking recovery plays. They have not arrived.');
    expect(recoveryMenuUnreadMessage()).not.toMatch(NOT_A_SETTLED_ANSWER);
  });

  it('does not treat a failed suggest as an empty play list', () => {
    expect(recoveryMenuPhase({ request: 'failed', playCount: 0 })).toBe('failed');
    expect(recoveryMenuFailedMessage()).toBe(
      'Could not load recovery plays. The suggestions have not arrived.',
    );
    expect(recoveryMenuFailedMessage()).not.toMatch(NOT_A_SETTLED_ANSWER);
  });

  it('keeps an arrived empty play list empty', () => {
    // Zero plays is honest only after the suggest landed and held none.
    expect(recoveryMenuPhase({ request: 'settled', playCount: 0 })).toBe('empty');
  });

  it('keeps a play that arrived', () => {
    expect(recoveryMenuPhase({ request: 'settled', playCount: 1 })).toBe('ready');
  });
});
