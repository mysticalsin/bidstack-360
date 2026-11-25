import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { PipelineByStageCard } from './PipelineByStageCard';

const SIEMENS = '11111111-1111-4111-8111-111111111111';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(opts?.[name] ?? '')),
  }),
}));

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoney: (value: number) => `EUR ${value}`,
  }),
}));

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

function renderCard(companyId: string, accountName = 'Siemens') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PipelineByStageCard companyId={companyId} accountName={accountName} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PipelineByStageCard', () => {
  it('draws this company’s bids and does not ask for the whole book', async () => {
    // WHY: on the Siemens cockpit the stage card said “Portfolio pipeline”
    // and counted every account. The salesperson was looking at one company.
    vi.mocked(api).mockResolvedValue({
      items: [
        { stage: 's1_ongoing', value: 2_500 },
        { stage: 'closed_won', value: 500 },
      ],
      nextCursor: null,
    });

    renderCard(SIEMENS);

    expect(await screen.findByText('S1 Ongoing')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Siemens pipeline by stage' })).toBeTruthy();
    expect(screen.getByText('Closed Won')).toBeTruthy();
    expect(screen.getAllByText('1')).toHaveLength(2);
    expect(screen.getByText('EUR 2500')).toBeTruthy();
    expect(screen.getByText('EUR 500')).toBeTruthy();
    expect(screen.queryByText('Portfolio pipeline')).toBeNull();
    expect(screen.queryByText('All-account pipeline by stage')).toBeNull();

    const url = String(vi.mocked(api).mock.calls[0]?.[0]);
    expect(url).toContain(`companyId=${SIEMENS}`);
    expect(url).not.toContain('Siemens');
    expect(url).not.toContain('search=');
  });

  it('does not request the book when the account is not a company id', () => {
    renderCard('Siemens');

    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText('This account is not linked to a company record.')).toBeTruthy();
    expect(screen.queryByText('Portfolio pipeline')).toBeNull();
  });

  it('says the stage read failed instead of leaving a skeleton', async () => {
    vi.mocked(api).mockRejectedValue(new Error('down'));

    renderCard(SIEMENS);

    expect(await screen.findByText("Couldn't load this account's pipeline")).toBeTruthy();
    expect(screen.queryByText('Portfolio pipeline')).toBeNull();
  });

  it('says the bars are a page when a later page was left behind', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [{ stage: 's2_sent', value: 100 }],
      nextCursor: '22222222-2222-4222-8222-222222222222',
    });

    renderCard(SIEMENS);

    expect(
      await screen.findByText('These bars are the first 200 bids on this account, not every bid.'),
    ).toBeTruthy();
  });
});
