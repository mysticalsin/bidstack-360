import { describe, expect, it } from 'vitest';

import { ACCOUNT_WATCH_EVENTS_DRAWN, accountWatchSignalCaption } from './account-watch-signal-caption';

describe('accountWatchSignalCaption', () => {
  it('does not describe five of six signals as the whole set', () => {
    // WHY: cutting Fay off and calling the five that remain "5 signals"
    // treats the slice as every signal. A later row means those drawn
    // signals are not every signal. Six that fit keep the old count.
    // No signal total is invented.
    const six = ['Ada', 'Bea', 'Cara', 'Dia', 'Eve', 'Fay'];
    const five = six.slice(0, 5);
    expect(accountWatchSignalCaption(five.length, five.length < six.length)).toBe(
      '5 in the latest 5, not every signal',
    );
    expect(accountWatchSignalCaption(five.length, five.length < six.length)).not.toBe('5 signals');
    expect(accountWatchSignalCaption(six.length, false)).toBe('6 signals');
    expect(accountWatchSignalCaption(six.length, false)).not.toMatch(/not every/i);
    expect(accountWatchSignalCaption(six.length, false)).not.toMatch(/View all/i);
  });

  it('says the fifty drawn signals are not every signal when another row was loaded', () => {
    // WHY: the account list draws fifty. One more loaded row means those
    // fifty are not every signal. Fifty that fit keep "50 signals".
    expect(accountWatchSignalCaption(ACCOUNT_WATCH_EVENTS_DRAWN, true)).toBe(
      '50 in the latest 50, not every signal',
    );
    expect(accountWatchSignalCaption(ACCOUNT_WATCH_EVENTS_DRAWN, false)).toBe('50 signals');
  });
});