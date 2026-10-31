import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
    expect(chart.textContent).toMatch(/Delivery/);
    expect(chart.textContent).toMatch(/Not recorded/);
    const dealLink = screen.getByRole('link', { name: /Pursuit · screening/ });
    expect(dealLink.getAttribute('href')).toBe('/opportunities/deal-1');
    expect(screen.getAllByText('Unknown')).toHaveLength(5);
    expect(screen.queryByText('Ada')).toBeNull();
  });
});
