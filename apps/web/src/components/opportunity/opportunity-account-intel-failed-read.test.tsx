// A snapshot that has not arrived is not an empty extract. The opportunity
// card used the same "No intelligence yet" line for a paused read as it does
// for a loaded account with no solutions.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountIntelSnapshot } from '@bidstack/shared';

const hook = vi.hoisted(() => ({
  useAccountIntel: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars = typeof fallback === 'object' && fallback !== null ? fallback : values;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: () => hook.useAccountIntel(),
}));

import { OpportunityAccountIntel } from './OpportunityAccountIntel';

const EMPTY_LINE = 'No intelligence yet';
const ACCOUNT = 'northwind-demo';

interface QueryShape {
  data?: AccountIntelSnapshot;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
}

function intel(state: QueryShape) {
  hook.useAccountIntel.mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    isLoading: state.isLoading ?? false,
    isPending: state.isPending ?? state.data === undefined,
    error: state.isError ? new Error('intel down') : null,
  });
}

function renderCard() {
  return render(<OpportunityAccountIntel accountId={ACCOUNT} />);
}

const EMPTY_SNAPSHOT: AccountIntelSnapshot = {
  solutions: [],
  products: [],
  extractions: [],
};

const LOADED_SNAPSHOT: AccountIntelSnapshot = {
  solutions: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      accountId: ACCOUNT,
      name: 'Harbor rollout',
      description: null,
      category: 'Cloud',
      status: 'active',
      extractedFromDocumentId: null,
      metadata: {},
      fieldSources: {},
      confidenceBps: 8000,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
  products: [],
  extractions: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('opportunity account intel failed read', () => {
  it('does not call a load in progress an empty extract', () => {
    // WHY: isLoading is false while the read is paused. The card still said
    // the account had no intelligence.
    intel({ isError: false, isLoading: false, isPending: true });
    renderCard();

    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText('Checking account intelligence.')).toBeTruthy();
    expect(screen.queryByText('Failed to load')).toBeNull();
  });

  it('does not call a failed read an empty extract', () => {
    // WHY: a failed snapshot has no solutions. That is not a confirmed empty
    // account. The error title stays.
    intel({ isError: true, isLoading: false, isPending: false });
    renderCard();

    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText('Failed to load')).toBeTruthy();
    expect(screen.queryByText('Checking account intelligence.')).toBeNull();
  });

  it('still says a loaded empty snapshot has no intelligence yet', () => {
    // WHY: a finished read with no solutions is still the empty extract.
    intel({
      data: EMPTY_SNAPSHOT,
      isError: false,
      isLoading: false,
      isPending: false,
    });
    renderCard();

    expect(screen.getByText(EMPTY_LINE)).toBeTruthy();
    expect(screen.queryByText('Checking account intelligence.')).toBeNull();
    expect(screen.queryByText('Failed to load')).toBeNull();
  });

  it('still names a solution once the snapshot has arrived', () => {
    // WHY: a loaded solution stays on the card. The unread sentence must not
    // replace it.
    intel({
      data: LOADED_SNAPSHOT,
      isError: false,
      isLoading: false,
      isPending: false,
    });
    renderCard();

    expect(screen.getByText('Harbor rollout')).toBeTruthy();
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.queryByText('Checking account intelligence.')).toBeNull();
  });
});
