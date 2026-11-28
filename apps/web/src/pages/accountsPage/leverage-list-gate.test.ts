import { describe, expect, it } from 'vitest';

import { leverageListGate } from './leverage-list-gate';

// WHY: the HEMA filter is a second read. Until that list returns, an empty
// account set is "still loading", not "nothing matched". A failed read is the
// same lie if the page says the filter matched nothing. A payload already on
// screen, including a successful empty list, is the only time the filter copy
// is allowed.
describe('leverage list gate', () => {
  it('holds the accounts list while the under-leveraged read has no payload', () => {
    expect(
      leverageListGate({ active: true, isLoading: true, isError: false, hasPayload: false }),
    ).toBe('loading');
  });

  it('does not call a failed under-leveraged read an empty filter', () => {
    expect(
      leverageListGate({ active: true, isLoading: false, isError: true, hasPayload: false }),
    ).toBe('failed');
  });

  it('keeps a payload that is already on screen when a later refresh fails', () => {
    expect(
      leverageListGate({ active: true, isLoading: false, isError: true, hasPayload: true }),
    ).toBe('settled');
  });

  it('settles a successful empty list so a real miss can say the filter matched nothing', () => {
    expect(
      leverageListGate({ active: true, isLoading: false, isError: false, hasPayload: true }),
    ).toBe('settled');
  });

  it('leaves the full accounts list alone when the HEMA filter is off', () => {
    expect(
      leverageListGate({ active: false, isLoading: true, isError: true, hasPayload: false }),
    ).toBe('settled');
  });
});
