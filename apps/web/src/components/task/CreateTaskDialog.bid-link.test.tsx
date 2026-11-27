// The new-task dialog loads the bid book so a follow-up can be linked.
// A paused read has isLoading false and no payload. The opportunity control
// then showed only None, which is the sentence for a book that arrived empty.
// A failed read did the same. An arrived empty book may still say None.
// A bid that arrived must stay on the list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreateTaskDialog } from './CreateTaskDialog';
import { useOpportunities } from '@/hooks/useOpportunities';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useCreateTask: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
}));

const BID = {
  id: '00000000-0000-4000-8000-000000020041',
  code: 'OP-2041',
  name: 'Synthetic annex',
};

const NOT_A_MISS = /\b(0|zero|empty|none|no bids)\b/i;

function mockBids(value: Record<string, unknown>) {
  vi.mocked(useOpportunities).mockReturnValue(value as ReturnType<typeof useOpportunities>);
}

function renderDialog() {
  return render(<CreateTaskDialog open onOpenChange={() => undefined} />);
}

function opportunityControl() {
  return screen.queryByRole('combobox', { name: /Opportunity/ });
}

describe('CreateTaskDialog bid link read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a paused bid read an empty link list', () => {
    // A pause reports isLoading false. The select used to offer only None.
    mockBids({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      fetchStatus: 'paused',
    });

    renderDialog();

    expect(screen.getByRole('heading', { name: 'New task' })).toBeTruthy();
    const checking = screen.getByText('Checking bids to link.');
    expect(checking.textContent).not.toMatch(NOT_A_MISS);
    expect(opportunityControl()).toBeNull();
    expect(screen.queryByText(/None/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create task' })).toBeTruthy();
  });

  it('does not call a failed bid read an empty link list', () => {
    mockBids({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('The bid read failed'),
      fetchStatus: 'idle',
    });

    renderDialog();

    const failed = screen.getByText('Could not load bids to link. They have not arrived.');
    expect(failed.textContent).not.toMatch(NOT_A_MISS);
    expect(opportunityControl()).toBeNull();
    expect(screen.queryByText(/None/)).toBeNull();
  });

  it('keeps None when the bid book arrived empty', () => {
    mockBids({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      fetchStatus: 'idle',
    });

    renderDialog();

    expect(opportunityControl()?.textContent).toMatch(/None/);
    expect(screen.queryByText('Checking bids to link.')).toBeNull();
  });

  it('keeps a bid that has arrived on the link list', () => {
    mockBids({
      data: { items: [BID], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      fetchStatus: 'idle',
    });

    renderDialog();

    const control = opportunityControl();
    expect(control).toBeTruthy();
    fireEvent.click(control as HTMLElement);
    expect(screen.getByRole('option', { name: /OP-2041/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Synthetic annex/ })).toBeTruthy();
    expect(screen.queryByText('Checking bids to link.')).toBeNull();
  });
});
