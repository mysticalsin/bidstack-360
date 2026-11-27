// The pipeline card on CRM Insights states a currency only after the
// opportunities read arrives. An idle, paused, or in-flight read has no
// payload. The card was still saying the endpoint does not send a currency,
// which marks the demo book as missing a currency it has not shown. A failed
// read with no payload is the same lie. A settled empty page and a settled
// row keep the existing amount wording, including "unspecified" when no code
// was sent. A code is named only when the arrived rows share one.
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import WorkspaceInsightsPage from './WorkspaceInsightsPage';
import { useInsightCompanies, useInsightOpportunities } from '@/hooks/useInsightsData';

vi.mock('@/components/charts/funnel-chart', () => ({
  FunnelChart: () => <div data-testid="pipeline-funnel" />,
}));

vi.mock('@/hooks/useInsightsData', () => ({
  useInsightOpportunities: vi.fn(),
  useInsightCompanies: vi.fn(),
}));

const MISSING_CURRENCY = /Currency is unspecified because this endpoint does not send one/;
const EMPTY_PIPELINE = 'No opportunities in the pipeline';
const DEMO_STAGE = 'S2 Sent';

type FetchStatus = 'idle' | 'paused' | 'fetching';

type OpportunityRead = {
  data: { items: Array<Record<string, unknown>>; complete: boolean } | undefined;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isPaused: boolean;
  isSuccess: boolean;
  isError: boolean;
  fetchStatus: FetchStatus;
  error: Error | null;
  refetch: () => void;
};

function opportunityRead(next: Partial<OpportunityRead> = {}): OpportunityRead {
  return {
    data: undefined,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isPaused: false,
    isSuccess: false,
    isError: false,
    fetchStatus: 'idle',
    error: null,
    refetch: vi.fn(),
    ...next,
  };
}

function demoOpportunity(currency?: string) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'OP-DEMO-1',
    customer: 'Demo North',
    name: 'Demo Rollout',
    stage: 's2_sent',
    pipelineStageId: null,
    pipelineStage: null,
    value: 120_000,
    probability: 40,
    dueDate: null,
    owner: null,
    industry: null,
    logo: null,
    country: null,
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-06-03T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...(currency ? { currency } : {}),
  };
}

function mockReads(opportunities: Partial<OpportunityRead>) {
  vi.mocked(useInsightOpportunities).mockReturnValue(
    opportunityRead(opportunities) as ReturnType<typeof useInsightOpportunities>,
  );
  vi.mocked(useInsightCompanies).mockReturnValue(
    opportunityRead({
      data: { items: [], complete: true },
      isSuccess: true,
      fetchStatus: 'idle',
    }) as ReturnType<typeof useInsightCompanies>,
  );
}

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function pipelineCard() {
  const heading = screen.getByRole('heading', { level: 2, name: 'Pipeline by stage' });
  const card = heading.parentElement?.parentElement?.parentElement;
  if (!card) throw new Error('pipeline card missing');
  return within(card);
}

function expectCurrencyNotJudged(card: ReturnType<typeof pipelineCard>) {
  expect(card.queryByText(MISSING_CURRENCY)).toBeNull();
  expect(card.queryByText(EMPTY_PIPELINE)).toBeNull();
  expect(card.queryByText(DEMO_STAGE)).toBeNull();
  expect(card.queryByText(/EUR|€/)).toBeNull();
}

describe('WorkspaceInsightsPage pipeline read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread pipeline missing a currency', () => {
    // WHY: the demo page paints before the opportunities request starts.
    // fetchStatus is idle and isLoading is false. There is no payload, so
    // the card must not say the endpoint omitted a currency and must not
    // say the pipeline is empty.
    mockReads({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage(<WorkspaceInsightsPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'CRM Insights' })).toBeTruthy();
    const card = pipelineCard();
    expect(card.getByRole('heading', { name: 'Pipeline by stage' })).toBeTruthy();
    expectCurrencyNotJudged(card);
  });

  it('does not call a paused pipeline missing a currency', () => {
    // WHY: a paused read (offline demo tab) has no rows. isLoading is false
    // because the fetch is not running. "Currency is unspecified" would say
    // the demo book was read and the endpoint left the currency out.
    mockReads({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage(<WorkspaceInsightsPage />);

    const card = pipelineCard();
    expect(card.getByRole('heading', { name: 'Pipeline by stage' })).toBeTruthy();
    expectCurrencyNotJudged(card);
  });

  it('does not call an in-flight pipeline missing a currency', () => {
    // WHY: the first fetch still has no rows. The caption was already
    // concluding that this endpoint does not send a currency. That conclusion
    // waits until the payload arrives.
    mockReads({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderPage(<WorkspaceInsightsPage />);

    const card = pipelineCard();
    expect(card.getByRole('heading', { name: 'Pipeline by stage' })).toBeTruthy();
    expectCurrencyNotJudged(card);
  });

  it('does not call a failed pipeline an empty book or a missing currency', () => {
    // WHY: a failed read has no amounts. The error is the read. It is not
    // an empty pipeline and not proof that the endpoint omits currency.
    mockReads({ isError: true, error: new Error('Pipeline unavailable') });
    renderPage(<WorkspaceInsightsPage />);

    const card = pipelineCard();
    expect(card.getByRole('heading', { name: 'Pipeline by stage' })).toBeTruthy();
    expect(card.getByRole('alert')).toBeTruthy();
    expect(card.getByText('Could not load this view')).toBeTruthy();
    expect(card.getByText('Pipeline unavailable')).toBeTruthy();
    expectCurrencyNotJudged(card);
  });

  it('keeps a settled empty pipeline empty, with no invented currency', () => {
    // WHY: a payload that arrived with no rows really is empty. The amount
    // wording stays unlabeled. The card does not invent EUR for a book that
    // sent no currency.
    mockReads({
      data: { items: [], complete: true },
      isSuccess: true,
    });
    renderPage(<WorkspaceInsightsPage />);

    const card = pipelineCard();
    expect(card.getByText(EMPTY_PIPELINE)).toBeTruthy();
    expect(card.getByText(MISSING_CURRENCY)).toBeTruthy();
    expect(card.queryByText(/EUR|€/)).toBeNull();
    expect(card.queryByText(DEMO_STAGE)).toBeNull();
  });

  it('keeps a loaded demo stage and leaves its amount unlabeled', () => {
    // WHY: a payload that arrived, including the synthetic demo stage, still
    // shows that stage. No currency on the row stays "unspecified". It does
    // not become EUR.
    mockReads({
      data: { items: [demoOpportunity()], complete: true },
      isSuccess: true,
    });
    renderPage(<WorkspaceInsightsPage />);

    const card = pipelineCard();
    expect(card.getByText(DEMO_STAGE)).toBeTruthy();
    expect(card.getByText(/120,000 unspecified/)).toBeTruthy();
    expect(card.getByText(MISSING_CURRENCY)).toBeTruthy();
    expect(card.queryByText(EMPTY_PIPELINE)).toBeNull();
    expect(card.queryByText(/EUR|€/)).toBeNull();
  });

  it('names a currency only when the arrived rows share that code', () => {
    // WHY: a shared code on the payload is the only currency label this
    // card may show. The unspecified sentence is for a payload that omitted
    // the code, not for a payload that sent one.
    mockReads({
      data: { items: [demoOpportunity('cad')], complete: true },
      isSuccess: true,
    });
    renderPage(<WorkspaceInsightsPage />);

    const card = pipelineCard();
    expect(card.getByText(/Amounts are in CAD/)).toBeTruthy();
    expect(card.getByText(DEMO_STAGE)).toBeTruthy();
    expect(card.getByText('CA$120,000')).toBeTruthy();
    expect(card.queryByText(MISSING_CURRENCY)).toBeNull();
    expect(card.queryByText(/EUR|€/)).toBeNull();
    expect(card.queryByText(/unspecified/)).toBeNull();
  });

  it('keeps a loaded demo stage when a later read fails', () => {
    // WHY: a refresh that fails does not erase a stage already on screen and
    // does not replace it with an empty pipeline. The failure sentence is
    // for a read that never arrived.
    mockReads({
      data: { items: [demoOpportunity()], complete: true },
      isSuccess: true,
      isError: false,
      isFetching: false,
      error: new Error('Pipeline unavailable'),
    });
    renderPage(<WorkspaceInsightsPage />);

    const card = pipelineCard();
    expect(card.getByText(DEMO_STAGE)).toBeTruthy();
    expect(card.queryByText('Pipeline unavailable')).toBeNull();
    expect(card.queryByText(EMPTY_PIPELINE)).toBeNull();
    expect(card.queryByText('Could not load this view')).toBeNull();
  });
});
