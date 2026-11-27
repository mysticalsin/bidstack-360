import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrossSellAction, CrossSellActionPage } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  actions: {
    data: undefined as CrossSellActionPage | undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null as Error | null,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock('@/hooks/useCrossSell', () => ({
  useCrossSellActions: () => hookMocks.actions,
  usePatchCrossSellAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useCreateCrossSellAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { CrossSellCard } from './CrossSellCard';

const EMPTY_LINE = 'No cross-sell actions logged for this account yet.';
const UNREAD_LINE = 'Checking cross-sell actions. The list has not arrived.';

const action: CrossSellAction = {
  id: '11111111-1111-4111-8111-111111111111',
  accountKey: 'northwind-demo',
  description: 'Introduce the security offer to the UK team',
  requestingUnit: 'France',
  assignedUnit: 'UK',
  assigneeId: null,
  assigneeName: null,
  dueDate: null,
  status: 'open',
  notes: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
};

function settle(data: CrossSellActionPage | undefined, extra: Partial<typeof hookMocks.actions> = {}) {
  hookMocks.actions = {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    fetchStatus: 'idle',
    ...extra,
  };
}

describe('cockpit cross-sell list before the read arrives', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused read an empty action log', () => {
    // WHY: a paused read has no payload, and isLoading is false, so the card
    // painted the settled empty sentence. Nothing has arrived yet.
    settle(undefined, { isPending: true, fetchStatus: 'paused' });
    render(<CrossSellCard accountKey="northwind-demo" />);
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText(UNREAD_LINE)).toBeTruthy();
  });

  it('does not call an in-flight read an empty action log', () => {
    // WHY: a load in progress is the same gap. A skeleton with no sentence
    // still leaves the card looking like a settled empty log.
    settle(undefined, { isLoading: true, isPending: true, fetchStatus: 'fetching' });
    render(<CrossSellCard accountKey="northwind-demo" />);
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText(UNREAD_LINE)).toBeTruthy();
  });

  it('does not call a failed read with no payload an empty action log', () => {
    // WHY: a failed read is not proof that this account has no cross-sell work.
    settle(undefined, { isError: true, error: new Error('network down') });
    render(<CrossSellCard accountKey="northwind-demo" />);
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText('Could not load cross-sell actions')).toBeTruthy();
    expect(screen.queryByText(UNREAD_LINE)).toBeNull();
  });

  it('still says a settled empty log has no actions', () => {
    // WHY: an arrived page with zero rows is a real empty log.
    settle({ items: [] });
    render(<CrossSellCard accountKey="northwind-demo" />);
    expect(screen.getByText(EMPTY_LINE)).toBeTruthy();
    expect(screen.queryByText(UNREAD_LINE)).toBeNull();
  });

  it('still shows an action that arrived', () => {
    settle({ items: [action] });
    render(<CrossSellCard accountKey="northwind-demo" />);
    expect(screen.getByText(action.description)).toBeTruthy();
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.queryByText(UNREAD_LINE)).toBeNull();
  });

  it('keeps an arrived action when a later read fails', () => {
    // WHY: a refresh failure must not replace a list the card already showed.
    settle({ items: [action] }, { isError: true, error: new Error('refresh failed') });
    render(<CrossSellCard accountKey="northwind-demo" />);
    expect(screen.getByText(action.description)).toBeTruthy();
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText('The latest cross-sell read failed. The list already on screen stays.')).toBeTruthy();
  });
});
