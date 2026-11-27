// A paused, idle, or in-flight initiative read has no payload. The board
// used the same "No initiatives yet" line as a settled empty page. That
// empty is not a finding. A failure with no payload is not an empty board.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KamInitiativeDetail } from '@bidstack/shared';
import type { useKamInitiatives } from '@/hooks/useKam';

vi.mock('@/hooks/useKam', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useKam')>('@/hooks/useKam');
  return {
    ...actual,
    useKamInitiatives: vi.fn(),
    useTransitionInitiative: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import { useKamInitiatives } from '@/hooks/useKam';
import { KamInitiativeBoard } from './kamPanels';

const CHECKING = 'Checking the initiative board. It has not arrived.';
const EMPTY = 'No initiatives yet';
const FAILED = "Couldn't load initiatives";
const LOADED_TITLE = 'Demo lane 61520';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

type InitiativeQuery = ReturnType<typeof useKamInitiatives>;

function initiativeQuery(partial: Partial<InitiativeQuery>): InitiativeQuery {
  return {
    refetch: vi.fn(),
    error: null,
    ...partial,
  } as InitiativeQuery;
}

function renderBoard(query: InitiativeQuery) {
  vi.mocked(useKamInitiatives).mockReturnValue(query);
  return render(<KamInitiativeBoard companyId={COMPANY_ID} />);
}

function expectNoSettledBoard() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(LOADED_TITLE)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(screen.queryByText(/Initiatives ·/)).toBeNull();
}

const LOADED: KamInitiativeDetail = {
  id: '33333333-3333-4333-8333-333333333333',
  companyId: COMPANY_ID,
  sessionId: null,
  title: LOADED_TITLE,
  description: null,
  stage: 'initiative',
  ownerId: null,
  priority: 'medium',
  estimatedValueMicros: 61520,
  lastActivityAt: '2026-11-26T00:00:00.000Z',
  droppedReason: null,
  convertedToOpportunityId: null,
  handoffId: null,
  createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z',
};

describe('KamInitiativeBoard unread board', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useKamInitiatives).mockReset();
  });

  it('does not call an idle initiative read an empty board', () => {
    // WHY: a read that has not started has isLoading false and no payload.
    // The board said No initiatives yet, while the columns have not arrived.
    renderBoard(
      initiativeQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'idle',
      }),
    );

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledBoard();
  });

  it('does not call a paused initiative read an empty board', () => {
    // WHY: a paused first read has isLoading false and no payload. Empty
    // columns and a zero count are only honest after a payload arrives.
    renderBoard(
      initiativeQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    );

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledBoard();
  });

  it('does not call an in-flight initiative read an empty board', () => {
    // WHY: a slow read showed only the skeleton. A board that has not
    // arrived is not a workshop with no initiatives.
    renderBoard(
      initiativeQuery({
        data: undefined,
        isError: false,
        isLoading: true,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    );

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledBoard();
  });

  it('does not call a failed initiative read an empty board', () => {
    // WHY: a failed read is not evidence that the account has no initiatives.
    // The error stays, and the board does not say the columns are empty.
    renderBoard(
      initiativeQuery({
        data: undefined,
        isError: true,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('offline'),
      }),
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(LOADED_TITLE)).toBeNull();
  });

  it('still shows a settled board that has no initiatives', () => {
    // WHY: a page that arrived with no initiatives is empty. That sentence
    // stays, so a real empty board is not dressed up as a slow network.
    renderBoard(
      initiativeQuery({
        data: { items: [], nextCursor: null },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LOADED_TITLE)).toBeNull();
  });

  it('still shows an initiative that has arrived, including 61520', () => {
    // WHY: a loaded card stays on the board. The unread line must not
    // replace a card the read already returned, including value 61520.
    renderBoard(
      initiativeQuery({
        data: { items: [LOADED], nextCursor: null },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(screen.getByText(LOADED_TITLE)).toBeTruthy();
    expect(screen.getByText('Initiatives · 1')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps an arrived board when a later read fails', () => {
    // WHY: a refresh that fails after the cards arrived is not an empty
    // board and not a missing board. The cards stay.
    renderBoard(
      initiativeQuery({
        data: { items: [LOADED], nextCursor: null },
        isError: true,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('offline'),
      }),
    );

    expect(screen.getByText(LOADED_TITLE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
