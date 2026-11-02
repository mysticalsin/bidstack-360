import { describe, expect, it } from 'vitest';

import { watchdogFeedAlertTake } from './watchdog-feed-alerts.js';

describe('watchdogFeedAlertTake', () => {
  it('does not cut six signals to five before the dashboard feed', () => {
    // WHY: the org feed took five alerts. Six signals then never reached the
    // dashboard pulse, and those five read as every new signal. One row past
    // the five the pulse draws has to be loaded. No signal total is invented,
    // and this is not a new query.
    const six = ['Ada', 'Bea', 'Cara', 'Dia', 'Eve', 'Fay'];
    const passed = six.slice(0, watchdogFeedAlertTake());
    expect(passed).toEqual(six);
    expect(passed).not.toEqual(six.slice(0, 5));
  });
});
