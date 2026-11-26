// A paused or in-flight enrichment read has no payload yet. The strip
// rendered nothing. That read has not arrived, and a blank strip is not a
// settled miss.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    dataUpdatedAt: 0,
  },
}));

vi.mock('@/hooks/useCompanyEnrichment', () => ({
  useCompanyEnrichment: () => hookMocks.query,
  useRefreshEnrichment: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    pollUntil: undefined,
  }),
  awaitingRefresh: () => false,
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

vi.mock('@/hooks/useSourcedFigures', () => ({
  useSourcedFigures: () => ({ revenue: null, employees: null, companyName: '' }),
  figureText: () => null,
  beatsProvider: () => false,
}));

import { FirmographicsStrip } from './FirmographicsStrip';

const CHECKING = 'Checking company facts. The enrichment has not arrived.';
const FAILED = 'Could not load company facts.';

function renderStrip() {
  return render(<FirmographicsStrip companyId="acct-1" />);
}

function loaded(industry: string | null) {
  return {
    companyId: 'acct-1',
    sample: false,
    status: 'ok',
    notice: null,
    stale: false,
    fetchedAt: '2026-10-30T00:00:00.000Z',
    firmographics: {
      revenue: {
        value: { amount: 85_000_000, currency: 'EUR', fiscalYear: 'FY2025' },
        source: 'Annual report',
        asOf: '2026-10-30',
      },
      headcount: null,
      industry: industry
        ? { value: industry, source: 'Registry', asOf: '2026-10-30' }
        : null,
      locations: {
        value: [{ city: 'Oslo', country: 'Norway', hq: true }],
        source: 'Registry',
        asOf: '2026-10-30',
      },
    },
  };
}

describe('FirmographicsStrip enrichment read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused enrichment read as missing', () => {
    // WHY: a paused first read has isLoading false and no payload. A blank
    // strip is a settled miss. This read has not arrived.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
      dataUpdatedAt: 0,
    };
    renderStrip();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Not known')).toBeNull();
    expect(screen.queryByText('Oslo (HQ)')).toBeNull();
    expect(screen.queryByTestId('account-firmographics')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight enrichment read as missing', () => {
    // WHY: a slow read also has no payload. A blank strip is not a settled
    // miss, and it is not a failed load.
    hookMocks.query = {
      data: undefined,
      isLoading: true,
      isError: false,
      status: 'pending',
      dataUpdatedAt: 0,
    };
    renderStrip();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Not known')).toBeNull();
    expect(screen.queryByText('Oslo (HQ)')).toBeNull();
    expect(screen.queryByTestId('account-firmographics')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed enrichment read on the error', () => {
    // WHY: a failed read is not evidence that the facts are unknown. The
    // error stays, and a blank strip does not stand in for the read.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      dataUpdatedAt: 0,
    };
    renderStrip();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Not known')).toBeNull();
    expect(screen.queryByTestId('account-firmographics')).toBeNull();
  });

  it('lets a failed read win over a stale industry', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Banking on screen from an enrichment that is no longer the read.
    hookMocks.query = {
      data: loaded('Banking'),
      isLoading: false,
      isError: true,
      status: 'error',
      dataUpdatedAt: 5,
    };
    renderStrip();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Banking')).toBeNull();
    expect(screen.queryByText('Oslo (HQ)')).toBeNull();
    expect(screen.queryByText('Not known')).toBeNull();
    expect(screen.queryByTestId('account-firmographics')).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: a status of error is a failed read even if isError has not flipped.
    // Undefined data in that state is not an unread pause, and a stale
    // industry must not stay.
    hookMocks.query = {
      data: loaded('Banking'),
      isLoading: false,
      isError: false,
      status: 'error',
      dataUpdatedAt: 5,
    };
    renderStrip();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Banking')).toBeNull();
    expect(screen.queryByText('Oslo (HQ)')).toBeNull();
    expect(screen.queryByText('Not known')).toBeNull();
  });

  it('stays blank when a settled read has a null payload', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and the strip stays blank.
    hookMocks.query = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 1,
    };
    renderStrip();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Not known')).toBeNull();
    expect(screen.queryByText('Oslo (HQ)')).toBeNull();
    expect(screen.queryByTestId('account-firmographics')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded industry', () => {
    // WHY: a loaded enrichment stays. The checking line must not replace
    // facts the read already returned.
    hookMocks.query = {
      data: loaded('Banking'),
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 2,
    };
    renderStrip();

    expect(screen.getByTestId('account-firmographics')).toBeTruthy();
    expect(screen.getByText('Banking')).toBeTruthy();
    expect(screen.getByText('Oslo (HQ)')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still says Not known for a loaded strip with a blank industry', () => {
    // WHY: a loaded enrichment with no industry stays Not known. Unread must
    // not look like that miss, and a real miss must stay.
    hookMocks.query = {
      data: loaded(null),
      isLoading: false,
      isError: false,
      status: 'success',
      dataUpdatedAt: 3,
    };
    renderStrip();

    expect(screen.getByTestId('account-firmographics')).toBeTruthy();
    expect(screen.getAllByText('Not known')).toHaveLength(2);
    expect(screen.getByText('Oslo (HQ)')).toBeTruthy();
    expect(screen.queryByText('Banking')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
