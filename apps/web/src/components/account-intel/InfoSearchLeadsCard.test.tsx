// WHY: demo leaves InfoSearch unset, so the card receives sample leads. Until
// that answer arrives, and when the read fails with nothing in hand, the
// caption must not say the rows were pulled live.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InfoSearchLeadsCard } from './InfoSearchLeadsCard';
import { api } from '@/lib/api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

const LIVE_CAPTION = /pulled live from InfoSearch/;
const SAMPLE_CAPTION = /Sample lead intel/;
const CHECKING_CAPTION = 'Checking InfoSearch for this account.';
const FAILED_CAPTION = 'InfoSearch could not be checked.';

const SAMPLE_LEAD = {
  id: 'sample-1',
  name: 'Jordan Avery',
  company: 'Northwind',
  title: 'VP, Technology',
  phone: '+1 555 0142',
  email: 'jordan.avery@example.com',
  listName: 'Q3 outbound',
};

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const view = render(<InfoSearchLeadsCard account="Northwind" />, { wrapper: Wrapper });
  return { ...view, client };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InfoSearch lead intel caption', () => {
  it('does not call a pending read a live pull', () => {
    vi.mocked(api).mockImplementation(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    renderCard();

    expect(screen.getByText(CHECKING_CAPTION)).toBeTruthy();
    expect(screen.queryByText(LIVE_CAPTION)).toBeNull();
    expect(screen.queryByText('Jordan Avery')).toBeNull();
  });

  it('does not call a failed read with no rows a live pull', async () => {
    vi.mocked(api).mockRejectedValue(new Error('down'));

    renderCard();

    expect(await screen.findByText(FAILED_CAPTION)).toBeTruthy();
    expect(screen.getByText('InfoSearch is unreachable')).toBeTruthy();
    expect(screen.queryByText(LIVE_CAPTION)).toBeNull();
    expect(screen.queryByText('Jordan Avery')).toBeNull();
  });

  it('keeps the sample label once preview leads arrive', async () => {
    vi.mocked(api).mockResolvedValue({
      enabled: false,
      preview: true,
      items: [SAMPLE_LEAD],
    });

    renderCard();

    expect(await screen.findByText('Jordan Avery')).toBeTruthy();
    expect(screen.getByText(SAMPLE_CAPTION)).toBeTruthy();
    expect(screen.queryByText(LIVE_CAPTION)).toBeNull();
    expect(screen.queryByText(CHECKING_CAPTION)).toBeNull();
  });

  it('keeps the live label when a connected catalog returns leads', async () => {
    vi.mocked(api).mockResolvedValue({
      enabled: true,
      preview: false,
      items: [{ ...SAMPLE_LEAD, id: 'live-1', name: 'Ada North' }],
    });

    renderCard();

    expect(await screen.findByText('Ada North')).toBeTruthy();
    expect(screen.getByText(LIVE_CAPTION)).toBeTruthy();
    expect(screen.queryByText(SAMPLE_CAPTION)).toBeNull();
    expect(screen.queryByText(CHECKING_CAPTION)).toBeNull();
  });
});
