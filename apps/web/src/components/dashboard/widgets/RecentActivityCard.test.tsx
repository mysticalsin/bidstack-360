import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { RecentActivityCard, activitySubtitle } from './RecentActivityCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children?: React.ReactNode }) => <div {...rest}>{children}</div>,
  },
}));

describe('activitySubtitle', () => {
  it('turns a stored stage key into words', () => {
    // WHY: the dashboard was showing closed_lost as a raw key next to the deal.
    expect(activitySubtitle('closed_lost')).toBe('Closed Lost');
    expect(activitySubtitle('s3_technical_iteration')).toBe('S3 Technical Iteration');
    expect(activitySubtitle('in_progress')).toBe('In Progress');
  });
});

describe('RecentActivityCard', () => {
  afterEach(cleanup);

  it('does not print the raw stage key', () => {
    render(
      <MemoryRouter>
        <RecentActivityCard
          activity={[
            {
              type: 'opportunity',
              title: 'Workspace consolidation',
              subtitle: 'closed_lost',
              date: '2026-10-31T12:00:00.000Z',
              url: '/opportunities/1',
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Closed Lost')).toBeTruthy();
    expect(screen.queryByText('closed_lost')).toBeNull();
  });
});
