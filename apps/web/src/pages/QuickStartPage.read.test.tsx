// A paused or in-flight workspace count has no totals yet. Quick Start
// said the book was empty. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const store = vi.hoisted(() => ({
  completedChecklist: [] as string[],
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: () => ({
    completedChecklist: store.completedChecklist,
    markChecklistItem: vi.fn(),
    startTour: vi.fn(),
    tourActive: false,
    openTemplatePicker: vi.fn(),
  }),
}));

import { QuickStartPage } from './QuickStartPage';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useUsers } from '@/hooks/useUsers';

const CHECKING_SUMMARY = 'Checking the workspace. The summary has not arrived.';
const CHECKING_TEAM = 'Checking teammates. The list has not arrived.';
const FAILED_SUMMARY = 'Failed to check the workspace';
const FAILED_TEAM = 'Failed to check teammates';
const LEAD = 'Add your first lead';
const DEAL = 'Create your first deal';
const TEAM = 'Invite your team';
const ALL_SET = "You're all set!";
const READY = 'Your workspace is ready to pilot bids.';

const ALL_CLICKS = [
  'profile',
  'template',
  'first_lead',
  'first_activity',
  'first_email',
  'connect_email',
  'first_deal',
  'invite_team',
];

function summaryBook(leads: number, opportunities: number) {
  return { leads, opportunities };
}

function teammates(names: Array<string | null>) {
  return names.map((name, index) => ({ id: `user-${index}`, name }));
}

function renderQuickStart(
  summary: {
    data?: unknown;
    isLoading?: boolean;
    isFetching?: boolean;
    isError?: boolean;
    status?: string;
  },
  users: {
    data?: unknown;
    isLoading?: boolean;
    isFetching?: boolean;
    isError?: boolean;
    status?: string;
  },
) {
  vi.mocked(useOrgSummary).mockReturnValue({
    data: summary.data,
    isLoading: summary.isLoading ?? false,
    isFetching: summary.isFetching ?? false,
    isError: summary.isError ?? false,
    status: summary.status,
    error: null,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useUsers).mockReturnValue({
    data: users.data,
    isLoading: users.isLoading ?? false,
    isFetching: users.isFetching ?? false,
    isError: users.isError ?? false,
    status: users.status,
    error: null,
    refetch: vi.fn(),
  } as never);
  render(
    <MemoryRouter>
      <QuickStartPage />
    </MemoryRouter>,
  );
}

function expectOpenBook() {
  expect(screen.getByText(LEAD)).toBeTruthy();
  expect(screen.getByText(DEAL)).toBeTruthy();
  expect(screen.getByText(TEAM)).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Onboarding progress' }).getAttribute('aria-valuenow')).toBe('0');
  expect(screen.queryByText(CHECKING_SUMMARY)).toBeNull();
  expect(screen.queryByText(CHECKING_TEAM)).toBeNull();
  expect(screen.queryByText(FAILED_SUMMARY)).toBeNull();
  expect(screen.queryByText(FAILED_TEAM)).toBeNull();
  expect(screen.queryByText(ALL_SET)).toBeNull();
  expect(screen.queryByText(READY)).toBeNull();
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
}

describe('QuickStartPage workspace count read', () => {
  afterEach(() => {
    store.completedChecklist = [];
    cleanup();
  });

  it('does not treat a paused workspace count as an empty book', () => {
    // WHY: a paused first read has isLoading false and no totals. Add your
    // first lead says the summary arrived. This one has not.
    renderQuickStart(
      { data: undefined, isLoading: false, isFetching: false, isError: false, status: 'pending' },
      { data: undefined, isLoading: false, isFetching: false, isError: false, status: 'pending' },
    );

    expect(screen.getByText(CHECKING_SUMMARY)).toBeTruthy();
    expect(screen.getByText(CHECKING_TEAM)).toBeTruthy();
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.queryByText(DEAL)).toBeNull();
    expect(screen.queryByText(TEAM)).toBeNull();
    expect(screen.queryByText(ALL_SET)).toBeNull();
    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(FAILED_SUMMARY)).toBeNull();
    expect(screen.queryByText(FAILED_TEAM)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight workspace count as an empty book', () => {
    // WHY: a slow read also has no totals, and isLoading can stay false.
    // The first-lead row must not stand in for a read that is still running.
    renderQuickStart(
      { data: undefined, isLoading: false, isFetching: true, isError: false, status: 'pending' },
      { data: undefined, isLoading: false, isFetching: true, isError: false, status: 'pending' },
    );

    expect(screen.getByText(CHECKING_SUMMARY)).toBeTruthy();
    expect(screen.getByText(CHECKING_TEAM)).toBeTruthy();
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.queryByText(DEAL)).toBeNull();
    expect(screen.queryByText(TEAM)).toBeNull();
    expect(screen.queryByText(ALL_SET)).toBeNull();
    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed workspace summary on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and Add your first lead must not open.
    renderQuickStart(
      { data: undefined, isLoading: false, isFetching: false, isError: true, status: 'error' },
      { data: [], isLoading: false, isFetching: false, isError: false, status: 'success' },
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_SUMMARY)).toBeTruthy();
    expect(screen.queryByText(CHECKING_SUMMARY)).toBeNull();
    expect(screen.queryByText(CHECKING_TEAM)).toBeNull();
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.queryByText(DEAL)).toBeNull();
    expect(screen.getByText(TEAM)).toBeTruthy();
    expect(screen.queryByText(ALL_SET)).toBeNull();
    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(FAILED_TEAM)).toBeNull();
  });

  it('lets a failed read win over a stale full book', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // lead, the deal, or the team that was already on screen, and it must
    // not say the workspace is ready.
    store.completedChecklist = ALL_CLICKS;
    renderQuickStart(
      {
        data: summaryBook(4, 2),
        isLoading: false,
        isFetching: false,
        isError: true,
        status: 'error',
      },
      {
        data: teammates(['Ada North', 'Ken Lee']),
        isLoading: false,
        isFetching: false,
        isError: true,
        status: 'error',
      },
    );

    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.queryByText(DEAL)).toBeNull();
    expect(screen.queryByText(TEAM)).toBeNull();
    expect(screen.queryByText(ALL_SET)).toBeNull();
    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText(FAILED_SUMMARY)).toBeTruthy();
    expect(screen.getByText(FAILED_TEAM)).toBeTruthy();
    expect(screen.queryByText(CHECKING_SUMMARY)).toBeNull();
    expect(screen.queryByText(CHECKING_TEAM)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale book, and it must not look ready.
    store.completedChecklist = ALL_CLICKS;
    renderQuickStart(
      {
        data: summaryBook(4, 2),
        isLoading: false,
        isFetching: false,
        isError: false,
        status: 'error',
      },
      {
        data: teammates(['Ada North', 'Ken Lee']),
        isLoading: false,
        isFetching: false,
        isError: false,
        status: 'error',
      },
    );

    expect(screen.queryByText(LEAD)).toBeNull();
    expect(screen.queryByText(DEAL)).toBeNull();
    expect(screen.queryByText(TEAM)).toBeNull();
    expect(screen.queryByText(ALL_SET)).toBeNull();
    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText(FAILED_SUMMARY)).toBeTruthy();
    expect(screen.getByText(FAILED_TEAM)).toBeTruthy();
    expect(screen.queryByText(CHECKING_SUMMARY)).toBeNull();
  });

  it('stays on an empty book when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed check, and it is not still checking.
    renderQuickStart(
      { data: null, isLoading: false, isFetching: false, isError: false, status: 'success' },
      { data: null, isLoading: false, isFetching: false, isError: false, status: 'success' },
    );

    expectOpenBook();
  });

  it('stays on an empty book when a settled count is zero', () => {
    // WHY: a zero count has arrived. Unread must not replace that settled
    // miss, and the miss must not say the check failed.
    renderQuickStart(
      {
        data: summaryBook(0, 0),
        isLoading: false,
        isFetching: false,
        isError: false,
        status: 'success',
      },
      { data: [], isLoading: false, isFetching: false, isError: false, status: 'success' },
    );

    expectOpenBook();
  });

  it('still finishes the team step when a loaded teammate name is blank', () => {
    // WHY: a loaded list stays. A blank name is still a member. Unread must
    // not drop the team, and the checklist must not invent a missing teammate.
    store.completedChecklist = ALL_CLICKS;
    renderQuickStart(
      {
        data: summaryBook(1, 1),
        isLoading: false,
        isFetching: true,
        isError: false,
        status: 'success',
      },
      {
        data: teammates([null, 'Ada North']),
        isLoading: false,
        isFetching: true,
        isError: false,
        status: 'success',
      },
    );

    expect(screen.getByRole('button', { name: LEAD }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: DEAL }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: TEAM }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(ALL_SET)).toBeTruthy();
    expect(screen.getByText(READY)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Onboarding progress' }).getAttribute('aria-valuenow')).toBe('100');
    expect(screen.queryByText(CHECKING_SUMMARY)).toBeNull();
    expect(screen.queryByText(CHECKING_TEAM)).toBeNull();
    expect(screen.queryByText(FAILED_SUMMARY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded book and its finished steps', () => {
    // WHY: a loaded payload stays. The unread line must not replace leads,
    // deals, or teammates the read already returned.
    store.completedChecklist = ALL_CLICKS;
    renderQuickStart(
      {
        data: summaryBook(3, 2),
        isLoading: false,
        isFetching: false,
        isError: false,
        status: 'success',
      },
      {
        data: teammates(['Ada North', 'Ken Lee']),
        isLoading: false,
        isFetching: false,
        isError: false,
        status: 'success',
      },
    );

    expect(screen.getByRole('button', { name: LEAD }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: DEAL }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: TEAM }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(ALL_SET)).toBeTruthy();
    expect(screen.getByText(READY)).toBeTruthy();
    expect(screen.queryByText(CHECKING_SUMMARY)).toBeNull();
    expect(screen.queryByText(FAILED_SUMMARY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
