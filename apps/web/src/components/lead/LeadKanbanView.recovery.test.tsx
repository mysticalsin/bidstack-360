// A recovery suggest that has not arrived is not an empty play list.
// The menu used to say "No suggestions." while the request was still out,
// and again when the request failed. An arrived empty list stays empty.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LeadSummary } from '@bidstack/shared';

const suggestState = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useLeads', () => ({ useUpdateLeadById: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/useLeadRot', () => ({
  useLeadRotConfig: () => ({ data: { items: [] }, isPending: false, isError: false }),
  useRecoverySuggest: () => suggestState,
}));
vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { LeadKanbanView } from './LeadKanbanView';

const CHECKING = 'Checking recovery plays. They have not arrived.';
const FAILED = 'Could not load recovery plays. The suggestions have not arrived.';
const EMPTY = 'No suggestions.';

function rottenLead(): LeadSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Ada',
    lastName: 'Sample',
    companyName: 'Example Co',
    email: 'ada@example.com',
    status: 'new',
    priority: 'medium',
    score: 40,
    source: 'cold_outreach',
    statusChangedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
  } as LeadSummary;
}

function renderBoard() {
  return render(
    <MemoryRouter>
      <LeadKanbanView leads={[rottenLead()]} />
    </MemoryRouter>,
  );
}

function openRecovery() {
  fireEvent.click(screen.getByRole('button', { name: /Open recovery plays/ }));
}

describe('LeadKanbanView recovery read', () => {
  afterEach(() => {
    cleanup();
    suggestState.mutateAsync.mockReset();
    suggestState.isPending = false;
    suggestState.isError = false;
  });

  it('does not call an in-flight recovery suggest an empty list', async () => {
    // WHY: opening the menu awaits the suggest. Until that payload arrives,
    // "No suggestions." is a settled answer the read has not earned.
    suggestState.mutateAsync.mockImplementation(() => new Promise(() => {}));
    renderBoard();
    openRecovery();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call a failed recovery suggest an empty list', async () => {
    // WHY: a rejected suggest is not evidence that there are no plays.
    // The menu stays on the error instead of "No suggestions."
    suggestState.mutateAsync.mockRejectedValue(new Error('offline'));
    renderBoard();
    openRecovery();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Schedule a call')).toBeNull();
  });

  it('keeps an arrived empty play list empty', async () => {
    // WHY: a suggest that arrived with no plays is empty. A slow network
    // must not be dressed up as that, and this one must.
    suggestState.mutateAsync.mockResolvedValue({ plays: [] });
    renderBoard();
    openRecovery();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a play that arrived', async () => {
    // WHY: a loaded play stays. The unread line must not replace a
    // suggestion the suggest already returned.
    suggestState.mutateAsync.mockResolvedValue({
      plays: [
        {
          kind: 'schedule_call',
          rationale: 'Call the buyer this week',
          payload: {},
          confidence: 0.5,
        },
      ],
    });
    renderBoard();
    openRecovery();

    expect(await screen.findByText('Schedule a call')).toBeTruthy();
    expect(screen.getByText('Call the buyer this week')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
