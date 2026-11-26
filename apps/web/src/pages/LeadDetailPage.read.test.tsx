// A paused or in-flight lead read has no record yet. The page still said
// the lead was not found, or that it may have been deleted, or showed only
// the skeleton. That is not a settled missing lead. The record has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LeadDetail } from '@bidstack/shared';

import { ApiError } from '@/lib/api';

const hookMocks = vi.hoisted(() => ({
  lead: {
    data: undefined as LeadDetail | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
    refetch: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useLeads', () => ({
  useLead: () => hookMocks.lead,
  useUpdateLead: () => ({ mutate: vi.fn(), isPending: false }),
  useConvertLead: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLead: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));

vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));

import { LeadDetailPage } from './LeadDetailPage';

const CHECKING = 'Checking this lead. The record has not arrived.';
const FAILED = "Couldn't load lead";
const FAILED_MESSAGE = 'The lead record did not load.';
const NOT_FOUND = 'Lead not found';
const DELETED = 'The lead may have been deleted or you may not have access to it.';
const DELETED_SHORT = 'The lead may have been deleted.';

const LEAD_ID = '11111111-1111-4111-8111-111111111111';

const loaded: LeadDetail = {
  id: LEAD_ID,
  firstName: 'Ada',
  lastName: 'Sample',
  email: 'ada@example.com',
  phone: null,
  companyName: 'Example Co',
  title: 'Buyer',
  source: 'cold_outreach',
  status: 'qualified',
  score: 40,
  priority: 'medium',
  ownerId: null,
  ownerName: null,
  convertedToOpportunityId: null,
  statusChangedAt: '2026-06-01T10:00:00.000Z',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  notes: 'Sample note about the demo lead',
  budget: null,
  authority: null,
  need: null,
  timeline: null,
  intel: null,
};

function settle(data: LeadDetail | undefined, extra: Partial<typeof hookMocks.lead> = {}) {
  hookMocks.lead = {
    data,
    isLoading: false,
    isError: false,
    error: null,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...extra,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/leads/${LEAD_ID}`]}>
      <Routes>
        <Route path="/leads/:id" element={<LeadDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoSettledMiss() {
  expect(screen.queryByText(NOT_FOUND)).toBeNull();
  expect(screen.queryByText(DELETED)).toBeNull();
  expect(screen.queryByText(DELETED_SHORT)).toBeNull();
  expect(screen.queryByRole('heading', { level: 1, name: 'Ada Sample' })).toBeNull();
  expect(screen.queryByText('Sample note about the demo lead')).toBeNull();
}

describe('LeadDetailPage unread record', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused lead read a missing record', async () => {
    // WHY: a paused first read has isLoading false and no payload. The page
    // said the lead was not found, while the record has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledMiss();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call an in-flight lead read a missing record', async () => {
    // WHY: a slow read showed only the loading skeleton. A record that has
    // not arrived is not a lead the API closed as missing.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledMiss();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not call a failed lead read a deleted record', async () => {
    // WHY: a failed read is not evidence that the lead was deleted. The
    // error stays, and the page does not say the lead is gone.
    settle(undefined, {
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new Error('offline'),
    });
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText(FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled 404 is a missing lead', async () => {
    // WHY: a record the server closed as missing stays on that sentence. A
    // slow network must not be dressed up as that outcome, and this one must.
    settle(undefined, {
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new ApiError('nf', 404, null),
    });
    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByText(DELETED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FAILED_MESSAGE)).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Ada Sample' })).toBeNull();
  });

  it('still shows a settled lead that arrived with no notes', async () => {
    // WHY: a lead that arrived with an empty notes field is still that lead.
    // The blank notes box stays, so a real record is not dressed up as missing.
    settle({ ...loaded, notes: null });
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Sample' })).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a lead that arrived', async () => {
    // WHY: a loaded lead stays on the page. The unread line must not
    // replace a record the read already returned.
    settle(loaded);
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Sample' })).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Example Co')).toBeTruthy();
    expect(screen.getByText('Sample note about the demo lead')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
