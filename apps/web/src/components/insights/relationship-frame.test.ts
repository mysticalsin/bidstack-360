import { describe, expect, it } from 'vitest';

import { relationshipFrameStatus, relationshipRefreshFailed } from './relationship-frame.js';

describe('relationship frame', () => {
  it('shows the empty state when the company list is empty even if the follow-up query is still pending', () => {
    expect(
      relationshipFrameStatus({
        companiesPending: false,
        companiesError: false,
        companyCount: 0,
        manualCompany: false,
        startPending: true,
        startHasData: false,
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
        startPending: true,
        startHasData: false,
        startFetching: false,
        startError: false,
      }),
    ).toBe('error');
  });

  it('loads only before the follow-up has a company, and keeps a resolved frame during refetch', () => {
    const base = {
      companiesPending: false,
      companiesError: false,
      companyCount: 2,
      manualCompany: false,
      startError: false,
    };
    expect(
      relationshipFrameStatus({ ...base, startPending: true, startFetching: true, startHasData: false }),
    ).toBe('loading');
    expect(
      relationshipFrameStatus({ ...base, startPending: false, startFetching: true, startHasData: true }),
    ).toBe('ready');
    const cachedFailure = {
      ...base,
      startPending: false,
      startFetching: false,
      startError: true,
      startHasData: true,
    };
    // The cached company stays on screen. The failure is a separate signal,
    // not a status of ready that swallows the error.
    expect(relationshipFrameStatus(cachedFailure)).toBe('ready');
    expect(relationshipRefreshFailed(cachedFailure)).toBe(true);
    expect(
      relationshipRefreshFailed({ ...cachedFailure, startError: false }),
    ).toBe(false);
    expect(
      relationshipFrameStatus({
        ...base,
        startPending: false,
        startFetching: false,
        startError: true,
        startHasData: false,
      }),
    ).toBe('error');
  });
});
