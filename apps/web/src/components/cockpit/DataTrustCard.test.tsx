import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountCockpitSnapshot, CrmCompany, SourceAttribution } from '@bidstack/shared';

import { DataTrustCard } from './DataTrustCard';

// Demo accounts carry a synthesized receipt (an opportunity row, or a seed
// profile) and a company.confidence copied from that same fixture. The card
// was averaging it into "Attribution confidence".

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    a: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
  },
  useReducedMotion: () => true,
}));

function receipt(overrides: Partial<SourceAttribution> = {}): SourceAttribution {
  return {
    source: 'external_crm',
    label: 'External CRM opportunity/customer record',
    sourceUrl: null,
    fetchedAt: '2026-11-20T12:00:00.000Z',
    confidence: 0.55,
    providerMetadata: {},
    ...overrides,
  };
}

function company(overrides: Partial<CrmCompany> = {}): CrmCompany {
  return {
    id: 'dnb',
    source: 'external_crm',
    name: 'DNB Bank',
    legalName: 'DNB Bank ASA',
    domain: 'dnb.no',
    website: null,
    industry: 'financial_services',
    employeeCount: 9000,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    confidence: 0.55,
    sourceAttribution: [receipt()],
    updatedAt: '2026-11-20T12:00:00.000Z',
    ...overrides,
  };
}

function cockpit(overrides: Partial<CrmCompany> = {}): AccountCockpitSnapshot {
  return { company: company(overrides) } as AccountCockpitSnapshot;
}

function confidenceText(): string {
  return screen.getByTestId('data-trust-confidence').textContent ?? '';
}

describe('DataTrustCard attribution confidence', () => {
  afterEach(cleanup);

  it('does not turn a demo opportunity placeholder into an attribution percentage', () => {
    // WHY: DNB Bank has a bid and no enrichment receipt. The cockpit still
    // attaches "External CRM opportunity/customer record" at 0.55, and the
    // company confidence is that same 0.55. A bid lead was reading 55% as
    // verified firmographics. The record was updated five days ago, which
    // must not read as a fresh source fetch either.
    render(<DataTrustCard cockpit={cockpit()} />);

    expect(confidenceText()).toBe('Not verified');
    expect(confidenceText()).not.toMatch(/55%|87%/);
    expect(screen.getByText('No external source is attached.')).toBeTruthy();
    expect(screen.queryByText('External CRM opportunity/customer record')).toBeNull();
    expect(screen.getByText('Freshness').parentElement?.textContent).toContain('Not verified');
    expect(screen.getByText('Freshness').parentElement?.textContent).not.toMatch(/ago|Nov/);
  });

  it('does not average a BidStack seed profile into attribution confidence', () => {
    // WHY: CI Financial's enrichment is a demo seed (seed_verified_profile,
    // 0.87). That fixture is not an external source. Showing 87% told a bid
    // lead the headcount and revenue had been attributed.
    render(
      <DataTrustCard
        cockpit={cockpit({
          name: 'CI Financial',
          confidence: 0.87,
          sourceAttribution: [
            receipt({
              source: 'seed_verified_profile',
              label: 'BidStack seed profile',
              sourceUrl: 'https://www.ci.com/',
              confidence: 0.87,
              fetchedAt: '2026-05-11T00:00:00.000Z',
            }),
          ],
        })}
      />,
    );

    expect(confidenceText()).toBe('Not verified');
    expect(screen.queryByText('BidStack seed profile')).toBeNull();
    expect(screen.queryByText('87%')).toBeNull();
  });

  it('keeps a recorded external receipt and ignores the seed row beside it', () => {
    render(
      <DataTrustCard
        cockpit={cockpit({
          confidence: 0.87,
          sourceAttribution: [
            receipt({
              source: 'seed_verified_profile',
              label: 'BidStack seed profile',
              confidence: 0.87,
            }),
            receipt({
              source: 'apollo_io',
              label: 'Apollo organization',
              sourceUrl: 'https://app.apollo.io/',
              confidence: 0.92,
              fetchedAt: '2026-11-01T00:00:00.000Z',
            }),
          ],
        })}
      />,
    );

    expect(confidenceText()).toBe('92%');
    expect(screen.getByText('1 attributed sources')).toBeTruthy();
    expect(screen.getByText('Apollo organization')).toBeTruthy();
    expect(screen.queryByText('BidStack seed profile')).toBeNull();
    expect(screen.queryByText('87%')).toBeNull();
  });
});
