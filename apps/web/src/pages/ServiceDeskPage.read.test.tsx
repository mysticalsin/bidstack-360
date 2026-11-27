// A paused or in-flight case list has no rows yet. The desk said there
// were no cases. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const hookMocks = vi.hoisted(() => ({
  useServiceCases: vi.fn(),
}));

vi.mock('@/hooks/useServiceCases', () => ({
  useServiceCases: hookMocks.useServiceCases,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { ServiceDeskPage } from './ServiceDeskPage';

const CHECKING = 'Checking cases. The list has not arrived.';
const FAILED = 'Failed to load cases';
const EMPTY = 'No cases yet';
const SUBJECT = 'Northwind printer';
const NUMBER = 'SD-1042';

function caseRow(subject: string, ownerName: string | null) {
  return {
    id: 'case-1',
    number: NUMBER,
    subject,
    status: 'open' as const,
    priority: 'high' as const,
    ownerName,
    source: 'email',
  };
}

function renderDesk(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useServiceCases.mockReturnValue({
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    status: query.status,
    error: query.error ?? null,
    refetch: vi.fn(),
  });
  render(
    <MemoryRouter>
      <ServiceDeskPage />
    </MemoryRouter>,
  );
}

describe('ServiceDeskPage case list read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused case list as an empty desk', () => {
    // WHY: a paused first read has isLoading false and no list. No cases yet
    // says the list arrived. This one has not.
    renderDesk({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NUMBER)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight case list as an empty desk', () => {
    // WHY: a slow read also has no list, and isLoading can stay false.
    // No cases yet must not stand in for a read that is still running.
    renderDesk({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NUMBER)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed case list on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and No cases yet must not open.
    renderDesk({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('desk down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NUMBER)).toBeNull();
  });

  it('lets a failed read win over a stale case', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // case that was already on screen.
    renderDesk({
      data: { items: [caseRow(SUBJECT, 'Ada North')], nextCursor: null },
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('desk down'),
    });

    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(NUMBER)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale case, and it must not look like an empty desk.
    renderDesk({
      data: { items: [caseRow(SUBJECT, 'Ada North')], nextCursor: null },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('desk down'),
    });

    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(NUMBER)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on no cases when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderDesk({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(NUMBER)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on no cases when a settled list is empty', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderDesk({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(NUMBER)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded case when the owner name is blank', () => {
    // WHY: a loaded case stays. A blank owner is loaded data. Unread must not
    // drop the case, and the desk must not invent an owner.
    renderDesk({
      data: { items: [caseRow(SUBJECT, null)], nextCursor: null },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(SUBJECT)).toBeTruthy();
    expect(screen.getByText(NUMBER)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded case and its subject', () => {
    // WHY: a loaded payload stays. The unread line must not replace a case
    // the read already returned.
    renderDesk({
      data: { items: [caseRow(SUBJECT, 'Ada North')], nextCursor: null },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(SUBJECT)).toBeTruthy();
    expect(screen.getByText(NUMBER)).toBeTruthy();
    expect(screen.getByText('Ada North')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
