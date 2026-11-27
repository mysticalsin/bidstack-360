// A paused or in-flight account read has no companies yet. The picker said
// there were no matching accounts, or it showed only a skeleton. That read
// has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/components/company/CompanyLogo', () => ({
  CompanyLogo: () => null,
}));

const companyMocks = vi.hoisted(() => ({
  useCompanies: vi.fn(),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: companyMocks.useCompanies,
}));

import { IntakeAccountPicker } from './IntakeAccountPicker';

const CHECKING = 'Checking accounts. The list has not arrived.';
const FAILED = 'Could not load accounts';
const EMPTY = 'No matching accounts.';

interface AccountRow {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
}

function renderPicker(query: {
  data?: { items: AccountRow[] } | null;
  isLoading: boolean;
  isError: boolean;
  status?: string;
  error?: Error;
}) {
  companyMocks.useCompanies.mockReturnValue(query);
  return render(<IntakeAccountPicker onSelect={() => undefined} />);
}

describe('IntakeAccountPicker read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused account read as an empty list', () => {
    // WHY: a paused first read has isLoading false and no companies. "No
    // matching accounts" is a settled empty list. This read has not arrived.
    renderPicker({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight account read as a skeleton', () => {
    // WHY: a slow read also has no companies. A skeleton with no status is
    // not a settled empty list, and it is not a failed load.
    renderPicker({ data: undefined, isLoading: true, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed account read on the error', () => {
    // WHY: a failed read is not evidence that no accounts match. The error
    // stays, and an empty list does not stand in for the read.
    renderPicker({ data: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets a failed read win over a stale account', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Northwind from a list that is no longer the read.
    renderPicker({
      data: { items: [{ id: 'co-northwind', name: 'Northwind', domain: 'northwind.example', industry: 'Energy' }] },
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByRole('button', { name: /Northwind/ })).toBeNull();
    expect(screen.queryByText('Northwind')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled read has no accounts', () => {
    // WHY: a read that arrived with an empty list stays empty. A slow
    // network must not be dressed up as no accounts, and this one must.
    renderPicker({ data: { items: [] }, isLoading: false, isError: false, status: 'success' });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays empty when a settled read is null', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and the list stays empty.
    renderPicker({ data: null, isLoading: false, isError: false, status: 'success' });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows an account when the industry is blank', () => {
    // WHY: a blank industry is a loaded account. Unread must not look like a
    // missing industry, and a real blank industry must stay on the account.
    renderPicker({
      data: { items: [{ id: 'co-blank', name: 'Blank Industry Co', domain: null, industry: '' }] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button', { name: 'Blank Industry Co' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows an account when the list has arrived', () => {
    // WHY: a loaded account stays. The unread line must not replace a name
    // the read already returned.
    renderPicker({
      data: { items: [{ id: 'co-northwind', name: 'Northwind', domain: 'northwind.example', industry: 'Energy' }] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button', { name: /Northwind/ })).toBeTruthy();
    expect(screen.getByText('Energy')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
