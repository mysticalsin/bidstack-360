import { describe, expect, it } from 'vitest';

import { relationshipFrameStatus } from './relationship-frame.js';

describe('relationship frame', () => {
  it('shows the empty state when the company list is empty even if the follow-up query is still pending', () => {
    expect(
      relationshipFrameStatus({
        companiesPending: false,
        companiesError: false,
        companyCount: 0,
        manualCompany: false,
        startFetching: false,
        startError: false,
      }),
    ).toBe('empty');
  });

  it('shows the company error instead of a loading skeleton', () => {
    expect(
      relationshipFrameStatus({
        companiesPending: false,
        companiesError: true,
        companyCount: 0,
        manualCompany: false,
        startFetching: false,
        startError: false,
      }),
    ).toBe('error');
  });

  it('waits only while the follow-up query is actually fetching', () => {
    const base = {
      companiesPending: false,
      companiesError: false,
      companyCount: 2,
      manualCompany: false,
      startError: false,
    };
    expect(relationshipFrameStatus({ ...base, startFetching: true })).toBe('loading');
    expect(relationshipFrameStatus({ ...base, startFetching: false })).toBe('ready');
  });
});
