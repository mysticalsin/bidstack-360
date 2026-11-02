import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { RecentOpportunitiesCard, recentItemsFromDeals } from './RecentOpportunitiesCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? ''),
      );
    },
  }),
}));

describe('RecentOpportunitiesCard', () => {
  it('links to the open deals for that account', () => {
    // WHY: "Open pipeline" used to land on a search that still listed closed bids.
    render(
      <MemoryRouter>
        <RecentOpportunitiesCard accountName="CI Financial" items={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Open pipeline/ }).getAttribute('href')).toBe(
      '/opportunities?search=CI%20Financial&excludeClosed=true',
    );
  });
});

describe('recentItemsFromDeals', () => {
  it('keeps an account deal that sits outside the first page of the global list', () => {
    const items = recentItemsFromDeals([
      {
        id: 'deal-1',
        name: 'DNB Bank — Cloud landing zone',
        stage: 'screening',
        amountMicros: 2_700_000_000_000,
        companyName: 'DNB Bank',
      },
    ]);

    expect(items).toEqual([
      {
        id: 'deal-1',
        name: 'DNB Bank — Cloud landing zone',
        customer: 'DNB Bank',
        value: '2.7M unspecified',
        stage: 'screening',
      },
    ]);
  });

  it('does not print a collapsed amount when the micros number is no longer exact', () => {
    // WHY: Number(micros) of this amount is one unit low, so the card would name the wrong figure.
    const huge = (9007199254740993n * 1_000_000n).toString();
    const items = recentItemsFromDeals([
      {
        id: 'deal-huge',
        name: 'Huge',
        stage: 'proposal',
        amountMicros: Number(huge),
        companyName: 'Acme',
      },
    ]);
    expect(items[0]?.value).toBe('Not recorded');
    expect(items[0]?.value).not.toContain('9,007,199,254,740,992');
  });

  it('leaves closed outcomes off the open opportunity list', () => {
    // WHY: the card says open opportunities. A closed won row made that caption false.
    const items = recentItemsFromDeals([
      {
        id: 'won',
        name: 'Won bid',
        stage: 'closed_won',
        amountMicros: '1350000000000',
        companyName: 'CI Financial',
      },
      {
        id: 'open',
        name: 'IT Modernization & MSP',
        stage: 'proposal',
        amountMicros: '1240000000000',
        companyName: 'CI Financial',
      },
      {
        id: 'lost',
        name: 'Lost bid',
        stage: 'closed_lost',
        amountMicros: '300000000000',
        companyName: 'CI Financial',
      },
    ]);
    expect(items.map((item) => item.name)).toEqual(['IT Modernization & MSP']);
    expect(items[0]?.value).toBe('1.24M unspecified');
  });
});
