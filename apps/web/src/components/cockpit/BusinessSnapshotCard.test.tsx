import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BusinessSnapshotCard } from './BusinessSnapshotCard';
import type { AccountCockpitSnapshot, CrmCompany } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoney: (value: number) => `EUR ${value.toLocaleString('en')}`,
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<HTMLElement, ComponentProps<'div'> & { children?: ReactNode }>(
      ({ children, ...props }, ref) => {
        const { animate, initial, transition, ...domProps } = props as Record<string, unknown>;
        void animate;
        void initial;
        void transition;
        return React.createElement(tag, { ...domProps, ref }, children);
      },
    );
    Component.displayName = `Motion${String(tag)}`;
    return Component;
  };

  return {
    animate: (_motion: unknown, value: number, options?: { onUpdate?: (value: number) => void }) => {
      options?.onUpdate?.(value);
      return { stop: vi.fn() };
    },
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => motionComponent(tag),
      },
    ),
    useMotionValue: (value: number) => ({ get: () => value, set: vi.fn() }),
    useReducedMotion: () => true,
  };
});

function company(overrides: Partial<CrmCompany> = {}): CrmCompany {
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
    annualRevenueMicros: 25_000_000_000_000,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: '2014-04-08',
    logo: null,
    technicalStack: [],
    strategicIntel: {
      provider: 'Apollo',
      lastSyncedAt: '2026-06-01T12:00:00.000Z',
      syncMode: 'apollo_api_organization_enrich',
      creditPolicy: 'uses_credits',
      freshness: 'fresh',
      employeeTrend: 'hiring',
      employeeCount: 1250,
      annualRevenueMicros: 25_000_000_000_000,
      intentTopics: ['cloud migration', 'zero trust'],
      hiringSignals: [],
      leadershipSignals: [{ id: 'sig-1', kind: 'leadership', label: 'New CIO', detail: null, observedAt: '2026-05-28T12:00:00.000Z', source: 'Apollo', confidence: 0.9, url: null, metadata: {} }],
      revenueSignals: [],
      newsSignals: [],
      summary: 'Active enterprise account.',
      limitations: [],
      signals: [],
    },
    confidence: 0.94,
    sourceAttribution: [
      {
        source: 'registry',
        label: 'Company Registry',
        sourceUrl: 'https://registry.example/acme',
        fetchedAt: '2026-06-02T12:00:00.000Z',
        confidence: 0.93,
        providerMetadata: {},
      },
    ],
    updatedAt: '2026-06-16T12:00:00.000Z',
    ...overrides,
  };
}

function cockpit(overrides: Partial<CrmCompany> = {}): AccountCockpitSnapshot {
  return {
    company: company(overrides),
    externalLastSyncedAt: '2026-06-01T12:00:00.000Z',
    kpis: [
      {
        label: 'Employees',
        value: '1,250+',
        detail: 'company headcount',
        tone: 'jade',
        sourceLabel: 'External fresh',
        sourceState: 'apollo_fresh',
        sourceHint: 'Synced 2026-06-01',
        block: 'external',
        fieldKey: 'employeeCount',
      },
      {
        label: 'Annual revenue',
        value: 'EUR 25M',
        detail: 'company revenue',
        tone: 'purple',
        sourceLabel: 'Manual override',
        sourceState: 'verified',
        sourceHint: 'Edited by a user',
        block: 'internal',
        overridden: true,
        fieldKey: 'annualRevenueMicros',
      },
    ],
    revenueEvolution: [],
    winLoss: { wonCount: 0, lostCount: 0, wonValueMicros: '0', lostValueMicros: '0', winRate: 0 },
    technicalStack: [],
    health: { score: 80, band: 'good', counts: {}, factors: [] },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

afterEach(() => cleanup());

describe('BusinessSnapshotCard provenance', () => {
  it('renders a source badge for every business snapshot field', () => {
    const { container } = render(<BusinessSnapshotCard cockpit={cockpit()} />);

    const rows = container.querySelectorAll('.kvlist .kv');
    const sourceBadges = container.querySelectorAll('.kv-source');

    expect(rows.length).toBeGreaterThan(0);
    expect(sourceBadges).toHaveLength(rows.length);
    expect(
      screen.getByTitle(
        'Average of attached source receipts. The stored company confidence is not shown.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('94%')).toBeNull();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('External fresh')).toBeTruthy();
    expect(screen.getAllByText('Company Registry').length).toBeGreaterThan(0);
    // The card bar is the filled-field share. The account signal score is a different number.
    expect(screen.getByText(/fields on this card are filled/)).toBeTruthy();
    expect(screen.queryByText(/80\/100/)).toBeNull();
  });

  it('cites Wikidata for public facts instead of the typed profile receipt', () => {
    render(
      <BusinessSnapshotCard
        cockpit={cockpit({
          legalName: 'DNB Bank ASA',
          incorporationDate: '2002-09-10',
          employeeCount: 9020,
          publicFacts: {
            description: 'DNB Bank is a Norwegian bank.',
            headquarters: 'Oslo, Norway',
            chiefExecutive: 'Kjerstin Braathen',
            stockExchange: 'Oslo Stock Exchange',
            revenueLabel: '54,857,000,000 NOK',
            revenueCurrency: 'NOK',
          },
          sourceAttribution: [
            {
              source: 'verified_data_source',
              label: 'Typed company profile. Not a scored source.',
              sourceUrl: null,
              fetchedAt: '2026-10-31T22:00:00.000Z',
              confidence: null,
              providerMetadata: {},
            },
            {
              source: 'wikidata',
              label: 'Wikidata entity profile',
              sourceUrl: 'https://www.wikidata.org/wiki/Q80788',
              fetchedAt: '2026-10-31T21:00:00.000Z',
              confidence: null,
              providerMetadata: {},
            },
          ],
        })}
      />,
    );

    expect(screen.getAllByText('Wikidata').length).toBeGreaterThan(3);
    expect(screen.queryByText(/Typed company profile/)).toBeNull();
    expect(screen.getByText('DNB Bank ASA')).toBeTruthy();
    expect(screen.getByText('2002-09-10')).toBeTruthy();
  });

  it('cites the account record when a saved legal name replaces the public one', () => {
    render(
      <BusinessSnapshotCard
        cockpit={cockpit({
          legalName: 'DNB Bank Group',
          legalNameSource: 'account',
          sourceAttribution: [
            {
              source: 'wikidata',
              label: 'Wikidata entity profile',
              sourceUrl: 'https://www.wikidata.org/wiki/Q80788',
              fetchedAt: '2026-10-31T21:00:00.000Z',
              confidence: null,
              providerMetadata: {},
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Account record')).toBeTruthy();
    expect(screen.getByText('DNB Bank Group')).toBeTruthy();
  });

  it('prints stored revenue from integer micros and skips a collapsed number', () => {
    // WHY: unitsFromMicros of a JSON number past the safe range moves the amount.
    const huge = (9007199254740993n * 1_000_000n).toString();
    const { unmount } = render(
      <BusinessSnapshotCard
        cockpit={cockpit({
          annualRevenueMicros: Number(huge),
          annualRevenueMicrosText: huge,
        })}
      />,
    );
    expect(screen.getByText(/9,007,199,254,740,993 unspecified/)).toBeTruthy();
    expect(screen.queryByText(/9,007,199,254,740,992/)).toBeNull();
    unmount();

    render(
      <BusinessSnapshotCard
        cockpit={cockpit({ annualRevenueMicros: Number('9007199254740993') })}
      />,
    );
    expect(screen.queryByText(/9,007,199/)).toBeNull();
  });

  it('does not invent a headquarters from the company name', () => {
    render(
      <BusinessSnapshotCard cockpit={cockpit({ name: 'DNB Bank', legalName: null })} />,
    );
    expect(screen.queryByText('Oslo, Norway')).toBeNull();
    expect(screen.queryByText('OSL:DNB')).toBeNull();
    expect(screen.queryByText('DNB Bank')).toBeNull();
  });
});
