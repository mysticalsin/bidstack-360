// The demo book stores proposal deadlines as dates, not instants. The Due
// column was formatting that date with `new Date('YYYY-MM-DD')`, which is UTC
// midnight. In America/Toronto — the org default — that instant is still the
// previous evening, so every seeded proposal showed the day before the date
// on the record. The deadline facet already buckets the calendar day.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en-US' },
  }),
}));

const SIEMENS = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  opportunityId: '33333333-3333-4333-8333-333333333333',
  name: 'Siemens ERP — Technical Proposal',
  status: 'review',
  version: 1,
  ownerId: null,
  complianceScore: 82,
  dueDate: '2026-12-25',
  createdAt: '2026-11-25T15:00:00.000Z',
  updatedAt: '2026-11-25T15:00:00.000Z',
};

vi.mock('@/lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.startsWith('/api/v1/proposals')) {
      return Promise.resolve({ items: [SIEMENS], total: 1 });
    }
    if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
    return Promise.resolve({});
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { ProposalsPage } from './ProposalsPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <NuqsAdapter>{children}</NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProposalsPage />, { wrapper: Wrapper });
}

describe('ProposalsPage — date-only deadline', () => {
  afterEach(() => {
    cleanup();
    process.env.TZ = 'UTC';
    window.history.replaceState(null, '', '/proposals');
  });

  it('prints the calendar day of a date-only deadline, not the previous evening west of UTC', async () => {
    // WHY: the seeded Siemens proposal is due 2026-12-25. America/Toronto reads
    // UTC midnight on that day as Dec 24, so the Due cell contradicted the
    // date stored on the row and the deadline facet, which already uses the
    // calendar day. The web suite pins TZ=UTC, which hides that shift, so this
    // test moves the zone before the cell formats.
    process.env.TZ = 'America/Toronto';
    renderPage();

    expect(await screen.findByRole('link', { name: 'Siemens ERP — Technical Proposal' })).toBeTruthy();
    expect(screen.getByText('Dec 25, 2026')).toBeTruthy();
    expect(screen.queryByText('Dec 24, 2026')).toBeNull();
  });
});
