import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany, CrmDeal } from '@bidstack/shared';

import { AccountCard } from './AccountCard';
import { deriveAccount } from './accountUtils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('framer-motion', () => {
  return {
    motion: {
      div: ({ children, ...props }: { children?: ReactNode }) => {
        const { animate, exit, initial, layout, transition, whileHover, whileTap, ...domProps } =
          props as Record<string, unknown>;
        void animate;
        void exit;
        void initial;
        void layout;
        void transition;
        void whileHover;
        void whileTap;
        return <div {...domProps}>{children}</div>;
      },
      span: ({ children, ...props }: { children?: ReactNode }) => {
        const { animate, initial, transition, ...domProps } = props as Record<string, unknown>;
        void animate;
        void initial;
        void transition;
        return <span {...domProps}>{children}</span>;
      },
    },
  };
});

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

const now = '2026-06-16T12:00:00.000Z';

function company(overrides: Partial<CrmCompany> = {}): CrmCompany {
  return {
    id: 'co-acme',
    source: 'external_crm',
    name: 'Acme',
    legalName: null,
    domain: null,
    website: null,
    industry: null,
    imageUrl: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.72,
    sourceAttribution: [],
    updatedAt: now,
    ...overrides,
  };
}

function deal(overrides: Partial<CrmDeal> = {}): CrmDeal {
  return {
    id: 'deal-1',
    source: 'external_crm',
    companyId: 'co-acme',
    companyName: 'Acme',
    name: 'Expansion',
    stage: 'proposal',
    amountMicros: 1_000_000_000_000,
    currencyCode: 'EUR',
    probability: 50,
    closeDate: null,
    ownerId: null,
    ownerName: null,
    updatedAt: now,
    ...overrides,
  };
}

function renderCard(row = deriveAccount(company(), [])) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountCard row={row} index={0} />
    </MemoryRouter>,
  );
}

describe('AccountCard coverage explainability', () => {
  it('shows the reason and next action for sparse signal coverage', () => {
    renderCard();

    expect(screen.getByText('Missing Industry, Domain, and Logo.')).toBeTruthy();
    expect(screen.getByText('Next: Assign an industry to unlock sector routing.')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Acme coverage insight: Missing Industry, Domain, and Logo. Next: Assign an industry to unlock sector routing.',
      ),
    ).toBeTruthy();
  });

  it('shows a complete signal message when every list signal is present', () => {
    const row = deriveAccount(
      company({
        industry: 'Manufacturing',
        domain: 'acme.example',
        employeeCount: 1200,
        logo: {
          url: 'https://cdn.example/acme.png',
          source: 'official_website',
          cachedAt: now,
          attribution: null,
        },
        technicalStack: [{ label: 'Cloud', items: [{ name: 'Azure', source: 'manual', confidence: 0.9 }] }],
      }),
      [deal()],
    );

    renderCard(row);

    expect(screen.getByText('All account list signals are present.')).toBeTruthy();
    expect(screen.getByText('Next: Open the cockpit to review strategy and activity.')).toBeTruthy();
  });
});

describe('AccountCard tech logos', () => {
  beforeEach(cleanup);

  it('shows the top three technologies with their logos and names the rest in the tooltip', () => {
    const row = deriveAccount(
      company({
        technicalStack: [
          { label: 'Cloud', items: [{ name: 'Azure', source: 'open_data:dns', confidence: 0.95 }, { name: 'AWS', source: 'open_data:dns', confidence: 0.6 }] },
          { label: 'CRM', items: [{ name: 'Salesforce', source: 'apollo_io', confidence: 0.82 }] },
          { label: 'Collaboration', items: [{ name: 'Microsoft 365', source: 'open_data:dns', confidence: 0.9 }] },
        ],
      }),
      [],
    );

    renderCard(row);

    const tech = screen.getByTestId('account-card-tech');
    expect([...tech.querySelectorAll('[data-tech-name]')].map((el) => el.getAttribute('data-tech-name'))).toEqual(['Azure', 'Microsoft 365', 'Salesforce']);
    expect(tech.getAttribute('title')).toBe('Azure, Microsoft 365, Salesforce, AWS');
  });

  it('keeps the pending label when the stack is empty', () => {
    renderCard();
    expect(screen.getByText('Tech stack pending')).toBeTruthy();
  });
});
