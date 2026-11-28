import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAccountSignals', () => ({
  useAccountTimeline: () => ({
    isLoading: false,
    isError: false,
    refetch: () => undefined,
    data: {
      companyId: 'c1',
      from: '2025-11-01T00:00:00.000Z',
      to: '2026-10-31T00:00:00.000Z',
      items: [
        {
          id: 'f1',
          at: '2026-06-01T00:00:00.000Z',
          lane: 'theirs',
          category: 'funding',
          title: 'Sample: Series C',
          summary: 'Raised to expand.',
          source: 'sample',
          sourceUrl: '',
          href: null,
          importance: 85,
          implication: 'OPPORTUNITY',
          sample: true,
          upcoming: false,
        },
      ],
    },
  }),
}));

import { SignalsTimeline } from './SignalsTimeline';

describe('signals timeline fixture label', () => {
  afterEach(cleanup);

  it('badges a sample:true row as Reference and does not call it Sample data', () => {
    render(
      <MemoryRouter>
        <SignalsTimeline companyId="c1" />
      </MemoryRouter>,
    );
    // The stored title can still carry an old "Sample:" prefix. The badge is what the seller reads.
    expect(document.querySelector('#signals-timeline .sg-sample')?.textContent).toBe('Reference');
    expect(screen.queryByText('Sample')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Funding,/ }));
    expect(screen.getByRole('heading', { name: 'Series C' })).toBeTruthy();
    expect(screen.getByText('Reference record')).toBeTruthy();
    expect(screen.queryByText(/Sample data/)).toBeNull();
  });
});
