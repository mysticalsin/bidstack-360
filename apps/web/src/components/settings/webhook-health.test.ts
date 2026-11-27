import { describe, expect, it } from 'vitest';

import { webhookHealthCounts } from './webhook-health';

describe('webhookHealthCounts', () => {
  it('does not turn a missing list into zeros', () => {
    // WHY: the settings hero and the overview tile both counted a missing
    // payload as an empty healthy book. Null is "not loaded", not zero.
    expect(webhookHealthCounts(null)).toBeNull();
    expect(webhookHealthCounts(undefined)).toBeNull();
  });

  it('keeps a settled empty list at zero', () => {
    // WHY: a finished read with no subscriptions is a real empty book.
    expect(webhookHealthCounts([])).toEqual({
      total: 0,
      active: 0,
      failing: 0,
      eventCount: 0,
      lastActivity: undefined,
    });
  });

  it('counts failing endpoints and the newer activity time', () => {
    // WHY: once the list has arrived, a failure and the latest delivery or
    // failure time have to stay visible. An earlier success must not hide a
    // later failure.
    expect(
      webhookHealthCounts([
        {
          active: true,
          failureCount: 0,
          events: ['bid.updated', 'bid.created'],
          lastDeliveryAt: '2026-11-01T00:00:00.000Z',
          lastFailureAt: null,
        },
        {
          active: false,
          failureCount: 3,
          events: ['bid.updated'],
          lastDeliveryAt: null,
          lastFailureAt: '2026-11-02T00:00:00.000Z',
        },
      ]),
    ).toEqual({
      total: 2,
      active: 1,
      failing: 1,
      eventCount: 2,
      lastActivity: '2026-11-02T00:00:00.000Z',
    });
  });
});
