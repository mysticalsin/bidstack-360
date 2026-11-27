import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TechStackCard } from './TechStackCard';
import type { AccountCockpitSnapshot, CrmCompany, TechnicalStackState } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  data: undefined as TechnicalStackState | undefined,
  isError: false,
  isFetching: false,
  isLoading: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useCompanyTechnicalStack', () => ({
  useCompanyTechnicalStack: () => ({
    data: hookMocks.data,
    isError: hookMocks.isError,
    isFetching: hookMocks.isFetching,
    isLoading: hookMocks.isLoading,
    refetch: vi.fn(),
  }),
  useSaveCompanyTechnicalStack: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefreshCompanyTechnicalStack: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAcceptTechnicalStackSuggestion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDismissTechnicalStackSuggestion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => {
          const Component = React.forwardRef<HTMLElement, { children?: React.ReactNode }>(
            ({ children, ...props }, ref) => {
              const { animate, initial, transition, whileHover, whileTap, ...domProps } =
                props as Record<string, unknown>;
              void animate;
              void initial;
              void transition;
              void whileHover;
              void whileTap;
              return React.createElement(tag, { ...domProps, ref }, children);
            },
          );
          Component.displayName = `Motion${tag}`;
          return Component;
        },
      },
    ),
    useReducedMotion: () => true,
  };
});

const CHECKING = 'Checking the technical stack. The saved stack has not arrived.';
const FAILED = 'Could not load the technical stack. The saved stack has not arrived.';
const EMPTY_TITLE = 'Build the stack from evidence';
const PULL_EMPTY = 'Pull source technologies into empty technical stack';

function company(): CrmCompany {
  return {
    id: 'acme-north',
    source: 'verified_data',
    name: 'Acme North',
    legalName: 'Acme North SAS',
    domain: 'acme.example',
    website: 'https://acme.example/',
    industry: 'Technology',
    imageUrl: null,
    employeeCount: 1250,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.94,
    sourceAttribution: [],
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}

function cockpit(stack: AccountCockpitSnapshot['technicalStack']): AccountCockpitSnapshot {
  return {
    company: company(),
    externalLastSyncedAt: null,
    kpis: [],
    revenueEvolution: [],
    winLoss: { wonCount: 0, lostCount: 0, wonValueMicros: 0, lostValueMicros: 0, winRate: 0 },
    technicalStack: stack,
    health: { score: 80, band: 'good', counts: {}, factors: [] },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

function emptyState(): TechnicalStackState {
  return {
    companyKey: 'acme-north',
    manualStack: [],
    providerStack: [],
    effectiveStack: [],
    suggestions: [],
    updatedAt: null,
  };
}

afterEach(() => {
  cleanup();
  hookMocks.data = undefined;
  hookMocks.isError = false;
  hookMocks.isFetching = false;
  hookMocks.isLoading = false;
});

describe('TechStackCard unread stack', () => {
  it('does not invite building a stack when the saved stack has not arrived', () => {
    // WHY: a paused read reports isLoading false and leaves data undefined.
    // An empty cockpit snapshot is not that read. The card must not offer
    // Pull sources or say the book is empty until a payload arrives.
    hookMocks.isLoading = false;
    hookMocks.isFetching = false;
    render(<TechStackCard cockpit={cockpit([])} />);

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByRole('button', { name: PULL_EMPTY })).toBeNull();
  });

  it('does not invite building a stack while the read is in flight', () => {
    // WHY: isLoading true is still not an empty book. The same invitation
    // would let a seller pull sources over a stack the card has not shown.
    hookMocks.isLoading = true;
    hookMocks.isFetching = true;
    render(<TechStackCard cockpit={cockpit([])} />);

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('does not invite building a stack when the read fails with no payload', () => {
    // WHY: a failed read has no rows. "Build the stack from evidence" would
    // record that failure as an empty technical stack.
    hookMocks.isError = true;
    render(<TechStackCard cockpit={cockpit([])} />);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still invites building a stack after a settled empty read', () => {
    // WHY: empty is a result only after the saved stack arrives with no rows.
    hookMocks.data = emptyState();
    render(<TechStackCard cockpit={cockpit([])} />);

    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('shows a stack that arrived on the saved read', () => {
    // WHY: a payload that arrived stays on the card, including a synthetic vendor.
    hookMocks.data = {
      ...emptyState(),
      effectiveStack: [
        { label: 'Data', items: [{ name: 'Databricks', source: 'manual', confidence: 1 }] },
      ],
    };
    render(<TechStackCard cockpit={cockpit([])} />);

    expect(screen.getByText('Databricks')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('keeps a cockpit snapshot stack while the saved read is still out', () => {
    // WHY: the dashboard snapshot is a payload that already arrived. Hiding
    // Azure because the dedicated stack read is pending would drop known rows.
    render(
      <TechStackCard
        cockpit={cockpit([
          {
            label: 'Cloud',
            items: [{ name: 'Azure', source: 'enrichment:apollo', confidence: 0.91 }],
          },
        ])}
      />,
    );

    expect(screen.getByText('Azure')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });
});
