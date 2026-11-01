import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountWorkstreamBoard } from './AccountWorkstreamBoard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

describe('AccountWorkstreamBoard', () => {
  afterEach(cleanup);

  it('draws lane length from recorded value and leaves an empty role off the route', () => {
    render(
      <MemoryRouter>
        <AccountWorkstreamBoard
          deals={[
            {
              id: 'deal-1',
              name: 'Cloud loading zone',
              stage: 'screening',
              value: 2_700_000,
              owner: 'Jane Smith',
            },
          ]}
          people={[{ id: 'p1', name: 'Ada', roleInDecision: null }]}
        />
      </MemoryRouter>,
    );

    const chart = screen.getByRole('img', { name: /Pursuit, 2\.7M unspecified/ });
    expect(chart.getAttribute('aria-label')).toMatch(/Delivery, Not recorded/);
    expect(chart.textContent).toMatch(/Not recorded/);
    const dealLink = screen.getByRole('link', { name: /Pursuit · screening/ });
    expect(dealLink.getAttribute('href')).toBe('/opportunities/deal-1');
    expect(screen.getAllByText('2.7M unspecified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No one recorded')).toHaveLength(5);
    // WHY: Ada is linked. Hiding her would read as an empty account.
    // She is not placed in a role, because a missing decision role is not Buyer.
    expect(screen.getByRole('heading', { name: 'Decision role not recorded' })).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('prints a lane past the safe unit count in full', () => {
    // WHY: compacting the collapsed unit number prints one unit low.
    const huge = (9007199254740993n * 1_000_000n).toString();
    render(
      <MemoryRouter>
        <AccountWorkstreamBoard
          deals={[
            {
              id: 'deal-huge',
              name: 'Large pursuit',
              stage: 'proposal',
              value: 0,
              valueMicros: huge,
              owner: null,
            },
          ]}
          people={[]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('img', { name: /Pursuit, 9,007,199,254,740,993 unspecified/ }),
    ).toBeTruthy();
    expect(screen.queryByText(/9,007,199,254,740,992/)).toBeNull();
    expect(screen.getAllByText('9,007,199,254,740,993 unspecified').length).toBeGreaterThan(0);
  });

  it('places a recorded buyer on that station and leaves them off the unassigned list', () => {
    render(
      <MemoryRouter>
        <AccountWorkstreamBoard
          deals={[]}
          people={[{ id: 'p1', name: 'Ada', roleInDecision: 'buyer' }]}
        />
      </MemoryRouter>,
    );

    const buyer = screen.getByText('Buyer').closest('li');
    expect(buyer?.textContent).toContain('Ada');
    expect(screen.queryByRole('heading', { name: 'Decision role not recorded' })).toBeNull();
  });
});
