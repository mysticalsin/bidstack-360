// A paused or in-flight account read has no companies yet. The new-agreement
// dialog showed only "Choose an account". That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useCompanies: vi.fn(),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: hookMocks.useCompanies,
}));

vi.mock('@/hooks/useMsa', () => ({
  useCreateMsa: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadMsaVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import { UploadDialog } from './UploadDialog';

const CHECKING = 'Checking accounts. The list has not arrived.';
const FAILED = 'Could not load accounts.';
const PLACEHOLDER = 'Choose an account';
const ACCOUNT = 'Northwind Advisory';

function company(industry: string | null) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: ACCOUNT,
    industry,
  };
}

function list(items: ReturnType<typeof company>[]) {
  return { items };
}

function renderDialog(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useCompanies.mockReturnValue(query);
  render(
    <UploadDialog
      open
      onOpenChange={() => undefined}
      target={{ mode: 'new' }}
    />,
  );
}

describe('UploadDialog account read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused account read as an empty account list', () => {
    // WHY: a paused first read has isLoading false and no companies. An empty
    // account picker says the catalog arrived. This one has not.
    renderDialog({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole('option', { name: PLACEHOLDER })).toBeNull();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight account read as an empty account list', () => {
    // WHY: a slow read also has no companies, and isLoading can stay false.
    // The empty picker must not stand in for a read that is still running.
    renderDialog({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole('option', { name: PLACEHOLDER })).toBeNull();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed account read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and the empty picker must not open.
    renderDialog({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('option', { name: PLACEHOLDER })).toBeNull();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
  });

  it('lets a failed read win over a stale account', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Northwind Advisory in the picker.
    renderDialog({
      data: list([company('Consulting')]),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByRole('option', { name: PLACEHOLDER })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale account, and it must not look like an empty list.
    renderDialog({
      data: list([company('Consulting')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByRole('option', { name: PLACEHOLDER })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderDialog({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: PLACEHOLDER })).toBeTruthy();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled list has no accounts', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderDialog({
      data: list([]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: PLACEHOLDER })).toBeTruthy();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded account', () => {
    // WHY: a loaded payload stays. The unread line must not replace an account
    // the read already returned.
    renderDialog({
      data: list([company('Consulting')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: ACCOUNT })).toBeTruthy();
    expect(screen.getByRole('option', { name: PLACEHOLDER })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded account with a blank industry', () => {
    // WHY: a blank industry is loaded data. Unread must not drop the account,
    // and the picker must not invent an industry.
    renderDialog({
      data: list([company(null)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: ACCOUNT })).toBeTruthy();
    expect(screen.queryByText('Consulting')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
