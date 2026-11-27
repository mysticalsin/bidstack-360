import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { TimelinePanel } from './TimelinePanel';

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TimelinePanel oppId="opp-1" />
    </QueryClientProvider>,
  );
}

describe('TimelinePanel — merged deal narrative', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Activity-model entries (calls/notes) with actor and relative time', async () => {
    // WHY this matters: the chatter Activity model existed but the opportunity
    // timeline never read it — calls and notes logged through /activities were
    // invisible on the deal page. This pins the new entry kinds rendering with
    // who did it and when.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/opportunities/opp-1/timeline') {
        return Promise.resolve({
          items: [
            {
              id: 'activity-a1',
              kind: 'call',
              text: 'Intro call with CTO',
              actorName: 'Jane Doe',
              createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
              metadata: { source: 'activity', status: 'completed', actorType: 'user' },
            },
            {
              id: 'comment-c1',
              kind: 'comment',
              text: 'Pricing looks tight',
              actorName: null,
              createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
            },
          ],
        });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText('Intro call with CTO')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    // Kind label is humanized and shown alongside the entry.
    expect(screen.getByText('call')).toBeTruthy();
    // Relative time, with the absolute date preserved in the datetime attr.
    expect(screen.getByText('2 hours ago')).toBeTruthy();
    // Legacy comment entries keep rendering in the same merged list.
    expect(screen.getByText('Pricing looks tight')).toBeTruthy();
  });

  it('shows the empty state when the deal has no history yet', async () => {
    apiMock.mockResolvedValue({ items: [] });

    renderPanel();

    expect(await screen.findByText('No activity yet')).toBeTruthy();
  });

  it('surfaces a fetch failure as an error state instead of a fake-empty feed', async () => {
    apiMock.mockRejectedValue(new Error('boom'));

    renderPanel();

    expect(await screen.findByText("Couldn't load the timeline")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('does not call a closed won demo deal an empty activity list', async () => {
    // WHY: seeded wins such as CI Financial Cloud migration are already
    // closed_won and have no audit row. "No activity yet" plus a promise
    // that stage moves will appear reads as a deal that never happened.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/opportunities/opp-1/timeline') return Promise.resolve({ items: [] });
      if (path === '/api/opportunities/opp-1') {
        return Promise.resolve({ stage: 'closed_won', pipelineStage: null });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText('This deal is already closed won')).toBeTruthy();
    expect(screen.getByText('The activity list has no stage move or note.')).toBeTruthy();
    expect(screen.queryByText('No activity yet')).toBeNull();
    expect(screen.queryByText('Stage moves, Dust webhooks, and notes will appear here.')).toBeNull();
  });

  it('does not call a closed lost demo deal an empty activity list', async () => {
    // WHY: a lost historical deal is decided too. The empty sentence has to
    // name the loss, or the tab still reads as a brand new bid.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/opportunities/opp-1/timeline') return Promise.resolve({ items: [] });
      if (path === '/api/opportunities/opp-1') {
        return Promise.resolve({
          stage: 'Lost',
          pipelineStage: { isWon: false, isLost: true },
        });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText('This deal is already closed lost')).toBeTruthy();
    expect(screen.queryByText('No activity yet')).toBeNull();
  });

  it('keeps the open-deal empty sentence when the bid is still open', async () => {
    // WHY: an open bid with no rows really has no activity yet. The closed
    // sentence must not appear just because the timeline request returned [].
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/opportunities/opp-1/timeline') return Promise.resolve({ items: [] });
      if (path === '/api/opportunities/opp-1') {
        return Promise.resolve({ stage: 's4_negotiation', pipelineStage: { isWon: false, isLost: false } });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText('No activity yet')).toBeTruthy();
    expect(screen.queryByText('This deal is already closed won')).toBeNull();
    expect(screen.queryByText('This deal is already closed lost')).toBeNull();
  });

  it('still draws a logged call on a closed won deal', async () => {
    // WHY: the closed sentence is only for a list with no rows. A won deal
    // that has a call must keep that call. The outcome must not replace it.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/opportunities/opp-1/timeline') {
        return Promise.resolve({
          items: [
            {
              id: 'activity-a1',
              kind: 'call',
              text: 'Procurement timeline check',
              actorName: 'Demo Owner',
              createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
            },
          ],
        });
      }
      if (path === '/api/opportunities/opp-1') {
        return Promise.resolve({ stage: 'closed_won', pipelineStage: null });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText('Procurement timeline check')).toBeTruthy();
    expect(screen.queryByText('This deal is already closed won')).toBeNull();
    expect(screen.queryByText('No activity yet')).toBeNull();
  });

  it('waits for the deal record before calling an empty list a new bid', async () => {
    // WHY: the timeline can settle empty before the deal record arrives. Painting
    // "No activity yet" in that gap is the same lie, one frame earlier.
    let resolveDeal: (deal: { stage: string; pipelineStage: null }) => void = () => {};
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/opportunities/opp-1/timeline') return Promise.resolve({ items: [] });
      if (path === '/api/opportunities/opp-1') {
        return new Promise((resolve) => {
          resolveDeal = resolve;
        });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    });
    expect(screen.queryByText('No activity yet')).toBeNull();
    expect(screen.queryByText('This deal is already closed won')).toBeNull();

    resolveDeal({ stage: 'closed_won', pipelineStage: null });

    expect(await screen.findByText('This deal is already closed won')).toBeTruthy();
    expect(screen.queryByText('No activity yet')).toBeNull();
  });
});
