// A paused or in-flight consulting partner read has no rows yet. The list
// still said No consulting partners found, or showed only the skeleton.
// That is not a settled empty list. The scan has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConsultingPartnerCard, ConsultingPartnersSummary } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  summary: {
    data: undefined as ConsultingPartnersSummary | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('@/hooks/useConsultingPartners', () => ({
  useConsultingPartners: () => hookMocks.summary,
  usePartnerEvidence: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
  useRefreshConsultingPartners: () => ({
    mutate: vi.fn(),
    isPending: false,
    pollUntil: undefined,
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => false }));

vi.mock('@/components/charts/PolarCharts', () => ({
  RadarChart: () => null,
}));

import { ConsultingPartnersSection } from './ConsultingPartnersSection';

const CHECKING = 'Checking consulting partners. The list has not arrived.';
const FAILED = "Couldn't load consulting partners";
const EMPTY = 'No consulting partners found';
const LOADED_NAME = 'Northwind Sample';

const loadedPartner: ConsultingPartnerCard = {
  firmKey: 'northwind',
  name: LOADED_NAME,
  monogram: 'NS',
  website: null,
  relationships: ['advisory'],
  domains: ['digital'],
  firstSeen: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-06-01T00:00:00.000Z',
  strength: { level: 'medium', score: 1, evidenceCount: 1 },
  publicCount: 1,
  internalCount: 0,
  record: { wins: 1, losses: 0, firstYear: 2026, lastYear: 2026 },
  scorecard: [
    {
      dimension: 'quality',
      status: 'no_evidence',
      us: null,
      partner: null,
      evidenceCount: 0,
      evidenceIds: [],
    },
  ],
  angles: [{ text: 'Sample advisory angle.', basis: 'observed', evidenceIds: ['e1'] }],
  timeline: [
    {
      id: 'e1',
      date: '2026-06-01T00:00:00.000Z',
      origin: 'public',
      source: 'google_news',
      label: 'Sample mention',
    },
  ],
  sample: false,
};

const emptySummary: ConsultingPartnersSummary = {
  companyId: 'c1',
  partners: [],
  sample: false,
  run: {
    status: 'ok',
    lastFetchedAt: '2026-06-01T00:00:00.000Z',
    result: { new: 0, updated: 0, skipped: 0, failed: 0 },
    detail: null,
  },
};

const loadedSummary: ConsultingPartnersSummary = {
  ...emptySummary,
  partners: [loadedPartner],
};

function settle(
  data: ConsultingPartnersSummary | undefined,
  extra: Partial<typeof hookMocks.summary> = {},
) {
  hookMocks.summary = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderList() {
  return render(
    <MemoryRouter>
      <ConsultingPartnersSection companyId="c1" />
    </MemoryRouter>,
  );
}

function expectNoSettledList() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByTestId('partners-empty')).toBeNull();
  expect(screen.queryByText(LOADED_NAME)).toBeNull();
  expect(screen.queryByText('Sample advisory angle.')).toBeNull();
}

describe('ConsultingPartnersSection unread list', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused partner read an empty list', async () => {
    // WHY: a paused first read has isLoading false and no rows. The list
    // said no consulting partners were found, while the scan has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderList();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledList();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call an in-flight partner read an empty list', async () => {
    // WHY: a slow read showed only the loading skeleton. A list that has
    // not arrived is not a scan that found no consulting partners.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderList();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledList();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('partners-skeleton')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not call a failed partner read an empty list', async () => {
    // WHY: a failed read is not evidence that no consulting partners exist.
    // The error stays, and the list does not say none were found.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderList();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledList();
  });

  it('still says a settled empty list found no consulting partners', async () => {
    // WHY: a scan that arrived with no partners stays empty. A slow network
    // must not be dressed up as that outcome, and this one must.
    settle(emptySummary);
    renderList();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByTestId('partners-empty')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LOADED_NAME)).toBeNull();
  });

  it('still shows a consulting partner that arrived', async () => {
    // WHY: a loaded partner stays on the list. The unread line must not
    // replace a partner the read already returned.
    settle(loadedSummary);
    renderList();

    expect(await screen.findByTestId('partner-northwind')).toBeTruthy();
    expect(screen.getByText(LOADED_NAME, { selector: '.cp-tile-name' })).toBeTruthy();
    expect(screen.getByText('Sample advisory angle.')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
