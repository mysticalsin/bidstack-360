import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { InfoSearchLeadsCard } from './InfoSearchLeadsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InfoSearchLeadsCard account="DNB Bank" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InfoSearchLeadsCard', () => {
  it('does not list sample people when InfoSearch is only a preview', async () => {
    vi.mocked(api).mockResolvedValue({
      enabled: false,
      preview: true,
      items: [
        {
          id: 'sample-1',
          name: 'Jordan Avery',
          company: 'DNB Bank',
          title: 'IT',
          phone: null,
          email: 'jordan@example.com',
          listName: 'Sample',
        },
      ],
    });

    renderCard();

    expect(await screen.findByText('No live call list. Sample names are not shown on this account.')).toBeTruthy();
    expect(screen.queryByText('Jordan Avery')).toBeNull();
  });

  it('lists people when the call list is live', async () => {
    vi.mocked(api).mockResolvedValue({
      enabled: true,
      preview: false,
      items: [
        {
          id: 'live-1',
          name: 'Sarah Bennett',
          company: 'DNB Bank',
          title: 'Buyer',
          phone: null,
          email: null,
          listName: 'Security',
        },
      ],
    });

    renderCard();

    await waitFor(() => expect(screen.getByText('Sarah Bennett')).toBeTruthy());
  });
});