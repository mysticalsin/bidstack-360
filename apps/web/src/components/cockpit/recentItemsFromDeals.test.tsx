import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  cleanup();
});

const OPEN_CAPTION = 'Open opportunities linked to CI Financial';

function openItem(name: string) {
  return {
    id: name,
    name,
    customer: 'CI Financial',
    value: 'Not recorded',
    stage: 'proposal',
  };
}

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

  it('does not describe five opportunities as every open opportunity when another is loaded', () => {
    // WHY: the card listed five and the caption treated that slice as the open
    // opportunities on the account. One more loaded row means those five are
    // not every opportunity. Five that match the loaded set keep the old wording.
    const six = ['Ada', 'Bea', 'Cara', 'Dia', 'Eve', 'Fay'].map(openItem);
    const { unmount } = render(
      <MemoryRouter>
        <RecentOpportunitiesCard accountName="CI Financial" items={six} />
      </MemoryRouter>,
    );
    expect(screen.getByText('5 in the latest 5, not every opportunity').textContent).toBe(
      '5 in the latest 5, not every opportunity',
    );
    expect(screen.queryByText(OPEN_CAPTION)).toBeNull();
    expect(screen.queryByText('Fay')).toBeNull();
    expect(screen.getByText('Eve')).toBeTruthy();
    unmount();

    render(
      <MemoryRouter>
        <RecentOpportunitiesCard accountName="CI Financial" items={six.slice(0, 5)} />
      </MemoryRouter>,
    );
    expect(screen.getByText(OPEN_CAPTION)).toBeTruthy();
    expect(screen.getByText('Eve')).toBeTruthy();
    expect(screen.queryByText(/not every opportunity/i)).toBeNull();
  });

  it('keeps the old wording when the loaded list is shorter than the slice', () => {
    // WHY: two loaded rows are the whole loaded set. The caption must not
    // claim a hidden opportunity that was not loaded.
    render(
      <MemoryRouter>
        <RecentOpportunitiesCard accountName="CI Financial" items={['Ada', 'Bea'].map(openItem)} />
      </MemoryRouter>,
    );
    expect(screen.getByText(OPEN_CAPTION)).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Bea')).toBeTruthy();
    expect(screen.queryByText(/not every opportunity/i)).toBeNull();
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
