// WHY: opening a contact (including from the account cockpit) must not tell
// the reader the account has no deals, tasks, or notes while those reads are
// still in flight or have failed. A settled empty book still says so. Notes
// the server stored under the lowercased account id must stay visible — the
// notes API lowercases accountId, and an exact compare to the display name
// hides every note the request just returned.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ContactDetailPage } from './ContactDetailPage';
import { useNotes } from '@/hooks/useNotes';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useTasks } from '@/hooks/useTasks';

// The test i18n bundle is empty, so the real t() returns the English fallback
// with {{placeholders}} still in it. Interpolate the fallback the way the
// loaded crm catalog does, so these assertions name the sentence a reader sees.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars = typeof fallback === 'object' && fallback ? fallback : opts;
      if (!vars) return template;
      return Object.entries(vars).reduce(
        (str, [name, value]) => str.replace(`{{${name}}}`, String(value)),
        template,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const refetchOpps = vi.fn();
const refetchTasks = vi.fn();
const refetchNotes = vi.fn();

vi.mock('@/hooks/useContacts', () => ({
  useContact: vi.fn(() => ({
    isLoading: false,
    isError: false,
    data: {
      id: 'c-1',
      customer: 'Globex',
      name: 'Hank Scorpio',
      role: 'CEO',
      email: null,
      phone: null,
      influence: null,
      sentiment: null,
      createdAt: new Date().toISOString(),
      companyId: null,
      linkState: 'needs_review',
    },
  })),
}));
vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
}));
vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn() }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: vi.fn() }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'c-1' }) };
});

const GLOBEX_DEAL = {
  id: 'o-1',
  code: 'OP-1',
  name: 'Globex deal',
  customer: 'Globex',
  stage: 'qualify',
  probability: 20,
};
const LABS_DEAL = {
  id: 'o-2',
  code: 'OP-2',
  name: 'Globex Labs deal',
  customer: 'Globex Labs',
  stage: 'qualify',
  probability: 20,
};

function renderPage() {
  render(
    <MemoryRouter>
      <ContactDetailPage />
    </MemoryRouter>,
  );
}

function settledOpps(items: unknown[]) {
  vi.mocked(useOpportunities).mockReturnValue({
    isLoading: false,
    isPending: false,
    isError: false,
    data: { items, nextCursor: null },
    refetch: refetchOpps,
  } as never);
}

function settledTasks(items: unknown[] = []) {
  vi.mocked(useTasks).mockReturnValue({
    isLoading: false,
    isPending: false,
    isError: false,
    data: { items },
    refetch: refetchTasks,
  } as never);
}

function settledNotes(items: unknown[] = []) {
  vi.mocked(useNotes).mockReturnValue({
    isLoading: false,
    isPending: false,
    isError: false,
    data: { items },
    refetch: refetchNotes,
  } as never);
}

describe('ContactDetailPage related work', () => {
  beforeEach(() => {
    refetchOpps.mockReset();
    refetchTasks.mockReset();
    refetchNotes.mockReset();
    settledOpps([GLOBEX_DEAL, LABS_DEAL]);
    settledTasks();
    settledNotes();
  });

  afterEach(() => cleanup());

  it('asks the server for this customer instead of filtering the first page of all deals', () => {
    renderPage();
    const filters = vi.mocked(useOpportunities).mock.calls.map((c) => c[0]);
    expect(filters.some((f) => f?.search === 'Globex')).toBe(true);
    expect(screen.getByText('OP-1')).toBeTruthy();
    expect(screen.queryByText('OP-2')).toBeNull();
  });

  it('does not call an in-flight book empty', () => {
    // A buyer who just opened the contact must not be told the account has
    // no work. Zero is a settled answer, not the loading one.
    vi.mocked(useOpportunities).mockReturnValue({
      isLoading: true,
      isPending: true,
      isError: false,
      data: undefined,
      refetch: refetchOpps,
    } as never);
    vi.mocked(useTasks).mockReturnValue({
      isLoading: true,
      isPending: true,
      isError: false,
      data: undefined,
      refetch: refetchTasks,
    } as never);
    vi.mocked(useNotes).mockReturnValue({
      isLoading: true,
      isPending: true,
      isError: false,
      data: undefined,
      refetch: refetchNotes,
    } as never);

    renderPage();

    expect(screen.queryByText('No opportunities for Globex.')).toBeNull();
    expect(screen.queryByText('No related tasks.')).toBeNull();
    expect(screen.queryByText('No notes for this account.')).toBeNull();
    expect(screen.queryByText('0 related')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading opportunities for Globex.' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading related tasks.' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading notes for this account.' })).toBeTruthy();
  });

  it('keeps tasks hidden while the deals they belong to are still loading', () => {
    // A task is related only through its deal. An empty task payload before
    // the deal list arrives is not "no related tasks".
    vi.mocked(useOpportunities).mockReturnValue({
      isLoading: true,
      isPending: true,
      isError: false,
      data: undefined,
      refetch: refetchOpps,
    } as never);
    settledTasks([
      {
        id: 't-1',
        oppId: 'o-1',
        title: 'Send the pricing note',
        status: 'open',
        dueDate: null,
        assignee: null,
      },
    ]);

    renderPage();

    expect(screen.queryByText('No related tasks.')).toBeNull();
    expect(screen.queryByText('Send the pricing note')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading related tasks.' })).toBeTruthy();
  });

  it('offers a retry when the deal list fails instead of saying there are none', () => {
    vi.mocked(useOpportunities).mockReturnValue({
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('offline'),
      data: undefined,
      refetch: refetchOpps,
    } as never);

    renderPage();

    expect(screen.queryByText('No opportunities for Globex.')).toBeNull();
    expect(screen.queryByText('No related tasks.')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Could not load opportunities for Globex.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry opportunities' }));
    expect(refetchOpps).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when tasks fail after the deals have settled', () => {
    settledOpps([GLOBEX_DEAL]);
    vi.mocked(useTasks).mockReturnValue({
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('offline'),
      data: undefined,
      refetch: refetchTasks,
    } as never);

    renderPage();

    expect(screen.queryByText('No related tasks.')).toBeNull();
    expect(screen.getByText('OP-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry tasks' }));
    expect(refetchTasks).toHaveBeenCalledTimes(1);
  });

  it('keeps a note whose account id was stored lowercased', () => {
    settledNotes([
      {
        id: 'n-1',
        accountId: 'globex',
        title: 'Kickoff',
        authorEmail: null,
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    ]);

    renderPage();

    expect(screen.getByText('Kickoff')).toBeTruthy();
    expect(screen.queryByText('No notes for this account.')).toBeNull();
  });

  it('still says the book is empty once every read has settled empty', () => {
    settledOpps([]);
    settledTasks();
    settledNotes();

    renderPage();

    expect(screen.getByText('No opportunities for Globex.')).toBeTruthy();
    expect(screen.getByText('No related tasks.')).toBeTruthy();
    expect(screen.getByText('No notes for this account.')).toBeTruthy();
    expect(screen.getAllByText('0 related')).toHaveLength(3);
  });
});
