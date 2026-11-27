import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountCockpitSnapshot, TechnicalStackState } from '@bidstack/shared';

import { FundingEligibilityCard } from './FundingEligibilityCard';

// Demo DNB Bank's stack is a sample fixture (Microsoft 365, Azure). The card
// was recommending ECIF from that fixture, and an empty stack read fell
// through to the cockpit snapshot, which still carried the canned
// Microsoft / AWS / Google catalog.

const read = vi.hoisted(() => ({
  current: {
    data: undefined as TechnicalStackState | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/components/company/TechLogo', () => ({
  TechLogo: () => <span aria-hidden>logo</span>,
}));

vi.mock('@/hooks/useCompanyTechnicalStack', () => ({
  useCompanyTechnicalStack: () => read.current,
}));

const CANNED: AccountCockpitSnapshot['technicalStack'] = [
  {
    label: 'IT Infrastructure',
    items: [
      { name: 'Microsoft 365', source: 'verified_tech_profile', confidence: 0.74 },
      { name: 'AWS', source: 'verified_tech_profile', confidence: 0.74 },
      { name: 'Google Cloud', source: 'verified_tech_profile', confidence: 0.74 },
    ],
  },
];

function cockpit(): AccountCockpitSnapshot {
  return { company: { name: 'DNB Bank' }, technicalStack: CANNED } as AccountCockpitSnapshot;
}

function stackState(overrides: Partial<TechnicalStackState> = {}): TechnicalStackState {
  return {
    companyKey: 'DNB Bank',
    manualStack: [],
    providerStack: [],
    effectiveStack: [],
    suggestions: [],
    updatedAt: null,
    coverage: null,
    ...overrides,
  };
}

function renderCard() {
  return render(<FundingEligibilityCard cockpit={cockpit()} />);
}

describe('FundingEligibilityCard', () => {
  afterEach(() => {
    cleanup();
    read.current = { data: undefined, isLoading: false, isError: false };
  });

  it('does not recommend ECIF from a demo sample stack', () => {
    read.current = {
      data: stackState({
        effectiveStack: [
          {
            label: 'Collaboration',
            items: [
              { name: 'Microsoft 365', source: 'open_data:dns', confidence: 0.95, sample: true },
              { name: 'Microsoft Azure', source: 'open_data:jobs', confidence: 0.79, sample: true },
            ],
          },
        ],
        coverage: {
          checkedAt: '2026-06-01T00:00:00.000Z',
          lanes: [],
          openItems: 2,
          apolloFallback: 'not_configured',
          apolloThreshold: 5,
          sample: true,
        },
      }),
      isLoading: false,
      isError: false,
    };
    renderCard();
    expect(screen.getByText('Microsoft, AWS, or Google names on this account are sample data, not a funding signal.')).toBeTruthy();
    expect(screen.queryByText('ECIF')).toBeNull();
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(screen.queryByText('AWS MAP')).toBeNull();
    expect(screen.queryByText('Google PSF')).toBeNull();
  });

  it('does not price co-funding from the cockpit catalog while the stack read is empty', () => {
    // WHY: an account with nothing on file used to inherit the cockpit snapshot.
    // That snapshot merged a canned Microsoft / AWS / Google catalog, so the
    // card recommended ECIF, MAP, and PSF together.
    read.current = {
      data: stackState(),
      isLoading: false,
      isError: false,
    };
    renderCard();
    expect(screen.getByText('No Microsoft, AWS, or Google footprint detected in the current stack.')).toBeTruthy();
    expect(screen.queryByText('ECIF')).toBeNull();
    expect(screen.queryByText('Recommended')).toBeNull();
  });

  it('holds the recommendation until the stack read settles', () => {
    read.current = { data: undefined, isLoading: true, isError: false };
    renderCard();
    expect(screen.getByRole('status').textContent).toContain("Checking this account's stack…");
    expect(screen.queryByText('ECIF')).toBeNull();
    expect(screen.queryByText('Recommended')).toBeNull();
  });

  it('does not invent a recommendation when the stack read fails', () => {
    read.current = { data: undefined, isLoading: false, isError: true };
    renderCard();
    expect(screen.getByRole('alert').textContent).toContain('Co-funding stays hidden until this account\'s stack loads.');
    expect(screen.queryByText('ECIF')).toBeNull();
  });

  it('still recommends ECIF when Azure was recorded and is not a sample', () => {
    read.current = {
      data: stackState({
        effectiveStack: [
          {
            label: 'Cloud',
            items: [{ name: 'Azure', source: 'open_data:dns', confidence: 0.9, sample: false }],
          },
        ],
        coverage: {
          checkedAt: '2026-06-01T00:00:00.000Z',
          lanes: [],
          openItems: 1,
          apolloFallback: null,
          apolloThreshold: 5,
          sample: false,
        },
      }),
      isLoading: false,
      isError: false,
    };
    renderCard();
    expect(screen.getByText('ECIF')).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
    expect(screen.getByText('Azure')).toBeTruthy();
    expect(screen.queryByText('AWS MAP')).toBeNull();
  });
});
