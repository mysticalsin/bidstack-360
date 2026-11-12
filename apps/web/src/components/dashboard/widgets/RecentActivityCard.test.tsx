import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { RecentActivityCard } from './RecentActivityCard';

afterEach(cleanup);

describe('RecentActivityCard', () => {
  it('shows stage and status codes as readable labels', () => {
    render(
      <MemoryRouter>
        <RecentActivityCard
          activity={[
            {
              type: 'opportunity',
              title: 'Core banking renewal',
              subtitle: 's4_negotiation',
              date: new Date().toISOString(),
              url: '/opportunities/opp-1',
            },
            {
              type: 'task',
              title: 'Send pricing annex',
              subtitle: 'in_progress',
              date: new Date().toISOString(),
              url: null,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('S4 Negotiation')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.queryByText('s4_negotiation')).toBeNull();
  });

  it('does not link to a page that does not exist', () => {
    // WHY: /activities is not a route. A "view all" link lands on Page not found.
    const activity = Array.from({ length: 9 }, (_, index) => ({
      type: 'opportunity',
      title: `Deal ${index}`,
      subtitle: null,
      date: new Date(Date.UTC(2026, 10, 12, index)).toISOString(),
      url: `/opportunities/opp-${index}`,
    }));
    render(
      <MemoryRouter>
        <RecentActivityCard activity={activity} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /view all/i })).toBeNull();
    expect(document.querySelector('a[href="/activities"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Deal 0' })).toBeTruthy();
  });
});
